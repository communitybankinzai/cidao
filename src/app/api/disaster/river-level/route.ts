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

const SOURCE_URL = 'http://suibo.bousai.pref.chiba.lg.jp/bousaip/river/graph_90_0.html'
const SOURCE_PAGE = 'http://suibo.bousai.pref.chiba.lg.jp/bousaip/river/graph_90_0.html'
const CACHE_SECONDS = 600

// ページから読めなかったときの基準値（2026-09-21 に県ページと国の観測所情報の両方で確認）
const DEFAULT_LEVELS = { standby: 2.4, caution: 2.6, danger: 2.8 }

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

function readLevel(html: string, label: string): number | null {
  const m = html.match(new RegExp(`${label}[\\s\\S]{0,120}?([0-9]+\\.[0-9]+)m`))
  return m ? Number(m[1]) : null
}

// 表は1行に「HH時の6値（00〜50分）」を左右2つ（0〜11時・12〜23時）並べている
function parseTeganuma(html: string) {
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

  const levels = {
    standby: readLevel(html, '水防団待機水位') ?? DEFAULT_LEVELS.standby,
    caution: readLevel(html, 'はん濫注意水位') ?? DEFAULT_LEVELS.caution,
    danger: readLevel(html, 'はん濫危険水位') ?? DEFAULT_LEVELS.danger,
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

function stageOf(level: number, levels: { standby: number; caution: number; danger: number }) {
  if (level >= levels.danger) return 'danger'
  if (level >= levels.caution) return 'caution'
  if (level >= levels.standby) return 'standby'
  return 'normal'
}

async function loadTeganuma() {
  const response = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
    next: { revalidate: CACHE_SECONDS },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const html = new TextDecoder('shift_jis').decode(await response.arrayBuffer())
  const { readings, levels } = parseTeganuma(html)
  const latest = readings.at(-1) ?? null
  // 時刻で60分前以前の最新値との差（欠測があっても6つ前とは限らないため）
  let change1h: number | null = null
  if (latest) {
    const target = new Date(latest.time).getTime() - 3600_000
    const past = readings.filter((r) => new Date(r.time).getTime() <= target).at(-1)
    if (past) change1h = Math.round((latest.level - past.level) * 100) / 100
  }
  return {
    id: 'teganuma',
    name: '手賀沼',
    river: '手賀沼',
    manager: '千葉県（柏土木事務所）',
    latest,
    change1h,
    stage: latest ? stageOf(latest.level, levels) : 'unknown',
    levels,
    recent: readings.slice(-18),
  }
}

// 手賀沼（県）と利根川の洪水予報（気象庁）は別々に取り、片方が失敗しても他方は返す
export async function GET(request: Request) {
  const [tega, tone] = await Promise.allSettled([loadTeganuma(), loadToneFloodForecasts()])
  const errors: string[] = []
  if (tega.status === 'rejected') errors.push(`手賀沼: ${tega.reason instanceof Error ? tega.reason.message : String(tega.reason)}`)
  if (tone.status === 'rejected') errors.push(`利根川の洪水予報: ${tone.reason instanceof Error ? tone.reason.message : String(tone.reason)}`)
  if (errors.length) console.error('[disaster/river-level]', errors.join(' / '))
  if (tega.status === 'rejected' && tone.status === 'rejected') {
    return NextResponse.json({ error: errors.join(' / ') }, { status: 502, headers: corsHeaders(request) })
  }
  return NextResponse.json(
    {
      fetchedAt: new Date().toISOString(),
      stations: tega.status === 'fulfilled' ? [tega.value] : [],
      // null＝取得に失敗、[]＝発表されていない（平常）
      floodForecasts: tone.status === 'fulfilled' ? tone.value : null,
      errors,
      source: { name: '千葉県 水防情報「水位グラフ:手賀沼」', url: SOURCE_PAGE },
      floodSource: { name: '気象庁 指定河川洪水予報（国土交通省と気象庁の共同発表）', url: JMA_FEED_URL },
      note: '千葉県の観測値をCBIが読み取って表示しています。0.00と欠測は除いています。避難の判断は市の避難情報に従ってください。',
    },
    { headers: { ...corsHeaders(request), 'Cache-Control': `public, max-age=300, s-maxage=${CACHE_SECONDS}` } },
  )
}
