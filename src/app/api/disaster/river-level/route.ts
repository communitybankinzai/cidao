// 手賀沼の水位（千葉県 水防情報「水位グラフ:手賀沼」）を読み取り、最新値と警戒段階を返す。
//
// 千葉県のページは http のみ・Shift_JIS の HTML で、閲覧者のブラウザ（https の防災MAP）からは直接読めない。
// ここで受けて 5 分キャッシュする（2026-09-21 夜に印旛沼の急な増水を受けて10分→5分）。**定期巡回はしない**（MAP が開かれたときだけ取りにいく）ので、
// 閲覧者が何人でも県への取得は観測所ごとに 5 分に 1 回まで＝1日最大 288 回（県の観測値は10分ごと）。
//
// 利根川（国の観測所）の水位はここで取得しない。国の「川の防災情報」は利用規約で
// 「定期的・定常的なデータ収集は控え、データ配信（有償）を使う」よう求めており、
// ツールからの取得には 403「This site prohibits data acquisition using tools」を返す（2026-09-21 確認）。
// 代わりに、気象庁の公開XMLフィードから利根川の「指定河川洪水予報」（国と気象庁が共同で出す
// 氾濫注意・警戒・危険・発生の情報）を読む。発表されていない間は空になる＝平常。
//
// ⚠ 県のページには 0.00（深夜に連続して出た・実際にはあり得ない値）と ***（欠測）が混ざる。
//    どちらも欠測として扱い、最新の有効な値を採る。
// ⚠ 県の利用条件は未確認（2026-09-21 時点）。問い合わせ中。停止の要請があれば直ちに止めること。
//
// 【履歴の保存（2026-09-24）】県のページは直近ぶんしか出さないため、見ていない間の値は二度と取れない。
// 台風25号で「排水機場の排水量（国交省・水資源機構の発表）が分かっても、そのとき沼の水位がどう動いたか」を
// 後から確かめられなかったので、取得したついでに10分値を disaster_river_levels へ貯める。
// **新しい定期実行は作らない**（Vercel の呼び出し回数を増やさないため）。MAP が開かれた分だけ貯まる＝夜間は穴が空く。
// 取り出しは `?history=1&hours=48`（保存した値を新しい順に返す）。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const CACHE_SECONDS = 300
const HISTORY_TABLE = 'disaster_river_levels'
const HISTORY_MAX_HOURS = 24 * 14
const pageUrl = (no: number) => `http://suibo.bousai.pref.chiba.lg.jp/bousaip/river/graph_${no}_0.html`

// 印旛沼には「はんらん危険水位」が無い（県のページも「---」）。計画高水位 4.25m の
// この高さ手前から「危険」とする（2026-09-21 事業主決定＝A案。市長の避難指示は 4.11m のとき）
const PLAN_HIGH_MARGIN_M = 0.2

type Levels = { standby: number | null; caution: number | null; danger: number | null; planHigh: number | null }

// 県の水位グラフの番号と、ページから読めなかったときの基準値（2026-09-21 に県ページで確認）
const STATIONS: { id: string; no: number; name: string; manager: string; fallback: Levels }[] = [
  { id: 'teganuma', no: 90, name: '手賀沼', manager: '千葉県（柏土木事務所）', fallback: { standby: 2.4, caution: 2.6, danger: 2.8, planHigh: null } },
  { id: 'nishi-inbanuma', no: 6, name: '西印旛沼', manager: '千葉県', fallback: { standby: 2.8, caution: 3.4, danger: null, planHigh: 4.25 } },
  { id: 'kita-inbanuma', no: 7, name: '北印旛沼', manager: '千葉県', fallback: { standby: 2.8, caution: 3.4, danger: null, planHigh: 4.25 } },
]

// 沼の水位だけでは「これから増えるのか、出せているのか」が分からない。
// 印旛沼に入ってくる川（入口）と、沼から水を出す先（出口）も並べる（2026-09-24）。
// この8局は県の「水位状況図（印旛地域）」1ページに最新値と基準値がまとまっているので、
// 追加の5局はそこから読む＝県への取得は5分に1ページ増えるだけ（個別ページを5枚取りにいかない）。
const AREA_MAP_URL = 'http://suibo.bousai.pref.chiba.lg.jp/bousaip/river/map_3_0.html'

type Role = 'inflow' | 'lake' | 'outflow'

const EXTRA_STATIONS: { id: string; no: number; name: string; river: string; role: Role; manager: string; note: string }[] = [
  { id: 'kabukibashi', no: 68, name: '鏑木橋', river: '高崎川', role: 'inflow', manager: '千葉県（印旛土木事務所）', note: '佐倉の市街地を通って印旛沼へ入る川' },
  { id: 'mawatari', no: 63, name: '馬渡', river: '鹿島川', role: 'inflow', manager: '千葉県（印旛土木事務所）', note: '印旛沼へいちばん多く流れ込む川' },
  { id: 'ajiki-naisui', no: 8, name: '安食内水', river: '長門川', role: 'outflow', manager: '水資源機構', note: '北の出口。利根川が高いと流せなくなる' },
  { id: 'owada-inner', no: 117, name: '大和田内水位', river: '印旛沼（大和田機場の沼側）', role: 'outflow', manager: '水資源機構', note: '西の出口。ポンプで花見川へ送り出す側' },
  { id: 'owada-outer', no: 116, name: '大和田外水位', river: '印旛沼（大和田機場の川側）', role: 'outflow', manager: '水資源機構', note: '送り出した先の水位' },
]

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8791',
  'http://localhost:8792',
  'http://localhost:8793',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

type Reading = { time: string; level: number }

// 「---」（基準なし）のときに次の行の数字を拾わないよう、ラベル直後の空白・タグだけを飛ばす。
// 戻り値 undefined＝ラベル自体が無い、null＝基準なし（---）
function readLevel(html: string, label: string): number | null | undefined {
  const m = html.match(new RegExp(`${label}(?:\\s|&nbsp;|<[^>]*>)*([0-9]+\\.[0-9]+m|---)`))
  if (!m) return undefined
  return m[1] === '---' ? null : Number(m[1].slice(0, -1))
}

// 表は1行に「HH時の6値（00〜50分）」を左右2つ（0〜11時・12〜23時）並べている
function parseStationPage(html: string, fallback: Levels) {
  const dateMatch = html.match(/(\d{4})年(\d{2})月(\d{2})日/)
  if (!dateMatch) throw new Error('観測日が読めません')
  const [, y, mo, d] = dateMatch

  const readings: Reading[] = []
  const block = /class="title">(\d{2})<\/th>((?:\s*<td[^>]*>[^<]*<\/td>){6})/g
  for (const m of html.matchAll(block)) {
    const hour = m[1]
    const cells = [...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1].replace(/&nbsp;/g, '').trim())
    cells.forEach((text, i) => {
      if (!/^\d+\.\d+$/.test(text)) return // 空欄（未受信）・***（欠測）・---（無効）
      const level = Number(text)
      if (!(level > 0)) return // 0.00 は欠測扱い
      readings.push({ time: `${y}-${mo}-${d}T${hour}:${String(i * 10).padStart(2, '0')}:00+09:00`, level })
    })
  }
  readings.sort((a, b) => a.time.localeCompare(b.time))

  const pick = (label: string, fb: number | null) => {
    const v = readLevel(html, label)
    return v === undefined ? fb : v
  }
  const levels: Levels = {
    standby: pick('水防団待機水位', fallback.standby),
    caution: pick('はん濫注意水位', fallback.caution),
    danger: pick('はん濫危険水位', fallback.danger),
    planHigh: pick('計画高水位相当', fallback.planHigh),
  }
  return { readings, levels }
}

// 気象庁の長期フィード（数日分）。指定河川洪水予報はここに載る
const JMA_FEED_URL = 'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml'
// 印西に関係する予報区域。「利根川水系桜川」などの支川は含めない
const FLOOD_AREA_PATTERN = /^利根川(上流部|下流部)?$/

type FloodForecast = {
  area: string
  level: number // 2〜5（警戒レベル相当）
  kindName: string
  headline: string
  mainText: string
  stations: string[]
  reportedAt: string
  sourceUrl: string
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? m[1].trim() : ''
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
    next: { revalidate: CACHE_SECONDS },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

// 予報区域ごとに最新の電文だけを見る。最新が解除・取消なら「発表中ではない」
async function loadToneFloodForecasts(): Promise<FloodForecast[]> {
  const feed = await fetchText(JMA_FEED_URL)
  const latestByArea = new Map<string, { url: string; updated: string }>()
  for (const entry of feed.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    if (tag(entry, 'title') !== '指定河川洪水予報') continue
    // 本文の先頭は「【利根川下流部レベル３氾濫警報】…」の形
    const area = tag(entry, 'content').match(/^【(.+?)レベル/)?.[1] ?? ''
    if (!FLOOD_AREA_PATTERN.test(area)) continue
    const updated = tag(entry, 'updated')
    const url = entry.match(/<link[^>]*href="([^"]+)"/)?.[1]
    if (!url) continue
    const prev = latestByArea.get(area)
    if (!prev || updated > prev.updated) latestByArea.set(area, { url, updated })
  }

  const results: FloodForecast[] = []
  for (const [area, { url }] of latestByArea) {
    const xml = await fetchText(url)
    const head = tag(xml, 'Head')
    const kind = tag(head, 'Kind')
    const condition = tag(kind, 'Condition')
    const code = Number(tag(kind, 'Code'))
    if (tag(head, 'InfoType') !== '発表' || condition.includes('解除') || !(code >= 20)) continue
    const warning = tag(xml, 'Warning')
    results.push({
      area,
      level: Math.floor(code / 10),
      kindName: tag(kind, 'Name'),
      headline: tag(tag(head, 'Headline'), 'Text'),
      mainText: tag(tag(warning, 'Property'), 'Text'),
      stations: [...warning.matchAll(/<Station>[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]),
      reportedAt: tag(head, 'ReportDateTime'),
      sourceUrl: 'https://www.jma.go.jp/bosai/flood/',
    })
  }
  return results.sort((a, b) => b.level - a.level)
}

function stageOf(level: number, levels: Levels) {
  if (levels.danger !== null && level >= levels.danger) return 'danger'
  if (levels.danger === null && levels.planHigh !== null && level >= levels.planHigh - PLAN_HIGH_MARGIN_M) return 'danger'
  if (levels.caution !== null && level >= levels.caution) return 'caution'
  if (levels.standby !== null && level >= levels.standby) return 'standby'
  return 'normal'
}

// 状況図の値は「&darr;  &nbsp;&nbsp;1.35[m]」「***[m]」（欠測）「---[m]」（無効）の形
function cellNumber(text: string) {
  const m = text.replace(/&nbsp;/g, ' ').match(/(-?\d+\.\d+)\[m\]/)
  return m ? Number(m[1]) : null
}

// 「09/24&nbsp;00：10」＋いまの年。年末年始に未来の日時にならないよう、先の日付なら前の年とみなす
function areaMapTime(text: string, now: Date) {
  const m = text.replace(/&nbsp;/g, ' ').match(/(\d{2})\/(\d{2})\s*(\d{2})[：:](\d{2})/)
  if (!m) return null
  const [, mo, d, h, mi] = m
  const year = now.getFullYear()
  const iso = (y: number) => `${y}-${mo}-${d}T${h}:${mi}:00+09:00`
  return new Date(iso(year)).getTime() - now.getTime() > 86400_000 ? iso(year - 1) : iso(year)
}

// 県の「水位状況図（印旛地域）」1ページから、局ごとの最新値・基準値をまとめて読む
export function parseAreaMap(html: string, now = new Date()) {
  const found = new Map<number, { level: number | null; time: string | null; trend: string; levels: Levels }>()
  for (const m of html.matchAll(/<div id="river(\d+)"([^>]*)>/g)) {
    const attrs: Record<string, string> = {}
    for (const a of m[2].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    if (!attrs.na) continue
    const suii = attrs.suii ?? ''
    const level = cellNumber(suii)
    found.set(Number(m[1]), {
      level: level !== null && level !== 0 ? level : null, // 0.00 は欠測扱い（個別ページと同じ）
      time: areaMapTime(attrs.time ?? '', now),
      trend: suii.includes('&uarr;') ? 'up' : suii.includes('&darr;') ? 'down' : 'flat',
      levels: {
        standby: cellNumber(attrs.sitei ?? ''),
        caution: cellNumber(attrs.keikai ?? ''),
        danger: cellNumber(attrs.kiken ?? ''),
        planHigh: cellNumber(attrs.keikaku ?? ''),
      },
    })
  }
  return found
}

// 入口（高崎川・鹿島川）と出口（長門川・大和田機場）。取れた局だけ返す
async function loadAreaStations() {
  const response = await fetch(AREA_MAP_URL, {
    headers: { 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
    next: { revalidate: CACHE_SECONDS },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const found = parseAreaMap(new TextDecoder('shift_jis').decode(await response.arrayBuffer()))
  return EXTRA_STATIONS.map((cfg) => {
    const hit = found.get(cfg.no)
    if (!hit || hit.level === null || !hit.time) return null
    const latest = { time: hit.time, level: hit.level }
    const hasStandard = Object.values(hit.levels).some((v) => v !== null)
    return {
      id: cfg.id,
      name: cfg.name,
      river: cfg.river,
      role: cfg.role,
      note: cfg.note,
      manager: cfg.manager,
      latest,
      change1h: null as number | null,
      trend: hit.trend,
      // 大和田の内外水位のように基準が決められていない局がある。「平常」と言い切らず「基準なし」を返す
      stage: hasStandard ? stageOf(hit.level, hit.levels) : 'nostd',
      levels: hit.levels,
      toPlanHigh:
        hit.levels.danger === null && hit.levels.planHigh !== null
          ? Math.round((hit.levels.planHigh - hit.level) * 100) / 100
          : null,
      sourceUrl: pageUrl(cfg.no),
      recent: [latest],
    }
  })
}

async function loadStation(cfg: (typeof STATIONS)[number]) {
  const response = await fetch(pageUrl(cfg.no), {
    headers: { 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
    next: { revalidate: CACHE_SECONDS },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const html = new TextDecoder('shift_jis').decode(await response.arrayBuffer())
  const { readings, levels } = parseStationPage(html, cfg.fallback)
  const latest = readings.at(-1) ?? null
  // 時刻で60分前以前の最新値との差（欠測があっても6つ前とは限らないため）
  let change1h: number | null = null
  if (latest) {
    const target = new Date(latest.time).getTime() - 3600_000
    const past = readings.filter((r) => new Date(r.time).getTime() <= target).at(-1)
    if (past) change1h = Math.round((latest.level - past.level) * 100) / 100
  }
  return {
    id: cfg.id,
    name: cfg.name,
    river: cfg.name,
    role: 'lake' as Role,
    note: '',
    manager: cfg.manager,
    latest,
    change1h,
    trend: change1h === null ? 'flat' : change1h > 0 ? 'up' : change1h < 0 ? 'down' : 'flat',
    stage: latest ? stageOf(latest.level, levels) : 'unknown',
    levels,
    // 危険水位が無い観測所（印旛沼）だけ、計画高水位までの残り（m）
    toPlanHigh:
      latest && levels.danger === null && levels.planHigh !== null
        ? Math.round((levels.planHigh - latest.level) * 100) / 100
        : null,
    sourceUrl: pageUrl(cfg.no),
    recent: readings.slice(-18),
  }
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Station =
  | Awaited<ReturnType<typeof loadStation>>
  | NonNullable<Awaited<ReturnType<typeof loadAreaStations>>[number]>

// 取得できた10分値を貯める。同じ観測値は主キー（観測所＋観測時刻）で弾かれるので、何度読んでも増えない
async function saveHistory(stations: Station[]) {
  const supabase = serviceClient()
  if (!supabase) return
  const rows = stations.flatMap((st) =>
    (st.recent ?? []).map((r) => ({ station_id: st.id, observed_at: r.time, level: r.level })),
  )
  if (!rows.length) return
  const { error } = await supabase.from(HISTORY_TABLE).upsert(rows, {
    onConflict: 'station_id,observed_at',
    ignoreDuplicates: true,
  })
  // 保存に失敗しても水位の表示は続ける（履歴は後から使う補助データ）
  if (error) console.error('[disaster/river-level] history', error.message)
}

// 貯めた履歴を返す（?history=1&hours=48&station=kita-inbanuma）
async function historyResponse(request: Request, url: URL) {
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503, headers: corsHeaders(request) })
  const hours = Math.min(HISTORY_MAX_HOURS, Math.max(1, Number(url.searchParams.get('hours')) || 48))
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  let query = supabase.from(HISTORY_TABLE).select('station_id, observed_at, level').gte('observed_at', since)
  const station = url.searchParams.get('station')
  if (station) query = query.eq('station_id', station)
  const { data, error } = await query.order('observed_at', { ascending: false }).limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(request) })
  return NextResponse.json(
    {
      hours,
      count: data?.length ?? 0,
      readings: data ?? [],
      note: '千葉県の水位をCBIが読み取って保存したもの。防災MAPが開かれたときだけ取得しているため、時間が抜けることがあります。',
      source: { name: '千葉県 水防情報（雨量・水位情報）', url: 'http://suibo.bousai.pref.chiba.lg.jp/' },
    },
    { headers: { ...corsHeaders(request), 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  )
}

// 県の観測所（手賀沼・印旛沼）と利根川の洪水予報（気象庁）は別々に取り、一部が失敗しても残りは返す
export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('history')) return historyResponse(request, url)
  const [tone, area, ...results] = await Promise.allSettled([
    loadToneFloodForecasts(),
    loadAreaStations(),
    ...STATIONS.map(loadStation),
  ])
  const msg = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason))
  const errors: string[] = []
  const lakes: Station[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') lakes.push(r.value as Awaited<ReturnType<typeof loadStation>>)
    else errors.push(`${STATIONS[i].name}: ${msg(r)}`)
  })
  const extras: Station[] = []
  if (area.status === 'fulfilled') {
    const got = area.value as Awaited<ReturnType<typeof loadAreaStations>>
    got.forEach((st, i) => {
      if (st) extras.push(st)
      else errors.push(`${EXTRA_STATIONS[i].river}（${EXTRA_STATIONS[i].name}）: 状況図に値がありません`)
    })
  } else {
    errors.push(`入口・出口の水位: ${msg(area)}`)
  }
  // 水の流れの順に並べる：入口（上流の川）→ 沼 → 出口（利根川・東京湾へ）
  const stations: Station[] = [
    ...extras.filter((s) => s.role === 'inflow'),
    ...lakes,
    ...extras.filter((s) => s.role === 'outflow'),
  ]
  if (tone.status === 'rejected') errors.push(`利根川の洪水予報: ${msg(tone)}`)
  if (errors.length) console.error('[disaster/river-level]', errors.join(' / '))
  if (stations.length) await saveHistory(stations)
  if (!stations.length && tone.status === 'rejected') {
    return NextResponse.json({ error: errors.join(' / ') }, { status: 502, headers: corsHeaders(request) })
  }
  return NextResponse.json(
    {
      fetchedAt: new Date().toISOString(),
      // 取れた観測所だけ。入口（高崎川・鹿島川）→ 沼（手賀沼・西印旛沼・北印旛沼）→ 出口（長門川・大和田機場）の順
      stations,
      // null＝取得に失敗、[]＝発表されていない（平常）
      floodForecasts: tone.status === 'fulfilled' ? tone.value : null,
      errors,
      source: { name: '千葉県 水防情報（雨量・水位情報）', url: 'http://suibo.bousai.pref.chiba.lg.jp/' },
      floodSource: { name: '気象庁 指定河川洪水予報（国土交通省と気象庁の共同発表）', url: JMA_FEED_URL },
      note: `千葉県の観測値をCBIが読み取って表示しています。0.00と欠測は除いています。沼に入ってくる川（高崎川・鹿島川）と、沼から水を出す先（長門川・大和田機場）も並べています。大和田の内水位・外水位には基準が決められていないため段階は付けていません。印旛沼ははんらん危険水位が無いため、計画高水位の${PLAN_HIGH_MARGIN_M}m手前から「危険」としています（CBIの目安）。避難の判断は市の避難情報に従ってください。`,
    },
    { headers: { ...corsHeaders(request), 'Cache-Control': `public, max-age=60, s-maxage=${CACHE_SECONDS}` } },
  )
}
