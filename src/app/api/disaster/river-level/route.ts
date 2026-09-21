// 手賀沼の水位（千葉県 水防情報「水位グラフ:手賀沼」）を読み取り、最新値と警戒段階を返す。
//
// 千葉県のページは http のみ・Shift_JIS の HTML で、閲覧者のブラウザ（https の防災MAP）からは直接読めない。
// ここで受けて 10 分キャッシュする。**定期巡回はしない**（MAP が開かれたときだけ取りにいく）ので、
// 閲覧者が何人でも県への取得は 10 分に 1 回まで＝1日最大 144 回。
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
import { NextResponse } from 'next/server'

const CACHE_SECONDS = 600
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
    manager: cfg.manager,
    latest,
    change1h,
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

// 県の観測所（手賀沼・印旛沼）と利根川の洪水予報（気象庁）は別々に取り、一部が失敗しても残りは返す
export async function GET(request: Request) {
  const [tone, ...results] = await Promise.allSettled([loadToneFloodForecasts(), ...STATIONS.map(loadStation)])
  const msg = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason))
  const errors: string[] = []
  const stations: Awaited<ReturnType<typeof loadStation>>[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') stations.push(r.value as Awaited<ReturnType<typeof loadStation>>)
    else errors.push(`${STATIONS[i].name}: ${msg(r)}`)
  })
  if (tone.status === 'rejected') errors.push(`利根川の洪水予報: ${msg(tone)}`)
  if (errors.length) console.error('[disaster/river-level]', errors.join(' / '))
  if (!stations.length && tone.status === 'rejected') {
    return NextResponse.json({ error: errors.join(' / ') }, { status: 502, headers: corsHeaders(request) })
  }
  return NextResponse.json(
    {
      fetchedAt: new Date().toISOString(),
      // 取れた観測所だけ（手賀沼・西印旛沼・北印旛沼の順）
      stations,
      // null＝取得に失敗、[]＝発表されていない（平常）
      floodForecasts: tone.status === 'fulfilled' ? tone.value : null,
      errors,
      source: { name: '千葉県 水防情報（雨量・水位情報）', url: 'http://suibo.bousai.pref.chiba.lg.jp/' },
      floodSource: { name: '気象庁 指定河川洪水予報（国土交通省と気象庁の共同発表）', url: JMA_FEED_URL },
      note: `千葉県の観測値をCBIが読み取って表示しています。0.00と欠測は除いています。印旛沼ははんらん危険水位が無いため、計画高水位の${PLAN_HIGH_MARGIN_M}m手前から「危険」としています（CBIの目安）。避難の判断は市の避難情報に従ってください。`,
    },
    { headers: { ...corsHeaders(request), 'Cache-Control': `public, max-age=300, s-maxage=${CACHE_SECONDS}` } },
  )
}
