// SNS巡回の候補（disaster_sns_candidates）から、AI（Claude Haiku）で「通れた／通れない／解除」と場所を読み取り、
// 座標を付けて disaster_sns_road_reports に保存する。未確認情報として地図に出す前提（2026-09-25 事業主決定A）。
//
// 正規表現だけの判定は、台風25号の実データ389件で場所が決まった投稿が0件・「解除された」を「通れない」と誤判定したため、
// 文の読み取りは AI に任せ、座標は「橋辞書 → OpenStreetMap Nominatim → 国土地理院 住所検索 → AIの推定（目安）」の順に決める。
// 一般公開は confidence=high だけ。AI の推定座標しか無いときは medium までに抑える（運営パネルにだけ出る）。
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import places from './disaster-sns-road-places.json'

export const SNS_ROAD_MODEL = 'claude-haiku-4-5'
export const SNS_ROAD_EVENT_START = '2026-09-20T00:00:00+09:00'
export const SNS_ROAD_TABLE = 'disaster_sns_road_reports'
export const SNS_ROAD_SCAN_TABLE = 'disaster_sns_road_scans'
// 地図の範囲（防災MAPと同じ）。この外の座標は捨てる
const AREA = { south: 35.72, north: 35.92, west: 140.03, east: 140.34 }
// AI に渡す前の粗いふるい。通行に触れていない投稿（避難所・停電など）に AI 費用を掛けない
const ROAD_WORDS = /通れ|通行|冠水|水没|開通|封鎖|迂回|橋|国道|道路|道が|アンダーパス|渋滞|抜けられ/

export type RoadKind = 'passed' | 'blocked' | 'cleared'
export type Confidence = 'high' | 'medium' | 'low'

type Candidate = {
  id: string
  platform: string
  permalink: string
  body_text: string
  posted_at: string
  review_status?: string | null
  raw_payload?: Record<string, unknown> | null
}

type Extraction = {
  is_road_report: boolean
  kind: RoadKind | 'unknown'
  location_text: string
  location_kind: 'bridge' | 'station' | 'road' | 'town' | 'facility' | 'other' | ''
  lat: number | null
  lng: number | null
  observed_at: string | null
  confidence: Confidence
  summary: string
  quote: string
  reason: string
}

export type SnsRoadReport = {
  id: string
  kind: RoadKind
  lat: number
  lng: number
  locationName: string
  locationBasis: string
  observedAt: string | null
  postedAt: string
  sourceUrl: string
  platform: string
  confidence: Confidence
  summary: string
  quote: string
  hidden: boolean
}

export function inArea(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= AREA.south && lat <= AREA.north && lng >= AREA.west && lng <= AREA.east
}

export function looksLikeRoadPost(text: string) {
  return ROAD_WORDS.test(String(text || '').normalize('NFKC'))
}

// 「〜付近」「〜あたり」「〜前」などを外し、地名検索に掛ける芯の部分だけ残す
export function coreLocationName(text: string) {
  return String(text || '').normalize('NFKC').replace(/\s+/g, '')
    .replace(/(の)?(付近|あたり|辺り|周辺|近く|手前|前|方面|方向|入口|出口|交差点|付け根|ところ|所|あと|側)$/u, '')
    .replace(/^(印西市|成田市|白井市|佐倉市|栄町|千葉県)/u, '')
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    is_road_report: { type: 'boolean', description: '投稿者自身が、特定の道・橋・場所の「通れた／通れない／通行止めが解除された」を伝えているか' },
    kind: { type: 'string', enum: ['passed', 'blocked', 'cleared', 'unknown'], description: 'passed=通れた・通行可能、blocked=通れない・通行止め・冠水で不通、cleared=通行止めの解除・開通、unknown=判断できない' },
    location_text: { type: 'string', description: '投稿に書かれた場所の名前（例：舟戸大橋、成田湯川駅付近、国道464号 台方〜北須賀）。1か所に特定できないときは空文字' },
    location_kind: { type: 'string', enum: ['bridge', 'station', 'road', 'town', 'facility', 'other', ''] },
    lat: { type: ['number', 'null'], description: 'その場所の緯度の推定。知らなければ null。作らない' },
    lng: { type: ['number', 'null'], description: 'その場所の経度の推定。知らなければ null。作らない' },
    observed_at: { type: ['string', 'null'], description: '投稿者がその状況を見た日時（ISO 8601・日本時間 +09:00）。本文に時刻や「今」「昨日18時」などの手掛かりがあるときだけ。無ければ null。投稿時刻で埋めない' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high=特定の1か所と状態が本文にはっきり書かれ、投稿者自身の見聞。medium=場所が地区・町名程度、または人づて・公式発表の転記。low=推測や曖昧' },
    summary: { type: 'string', description: '地図の吹き出しに出す1文（40字以内・敬体不要・例：国道464号の台方〜北須賀が冠水で通行止め）' },
    quote: { type: 'string', description: '判断の根拠になった本文の一節（そのまま・80字以内）' },
    reason: { type: 'string', description: '判定理由（短く）' },
  },
  required: ['is_road_report', 'kind', 'location_text', 'location_kind', 'lat', 'lng', 'observed_at', 'confidence', 'summary', 'quote', 'reason'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `あなたは千葉県印西市とその周辺（成田市・白井市・佐倉市・栄町）の防災マップの係です。
SNSの投稿1件を読み、「特定の道・橋・場所が 通れた／通れない／通行止めが解除された」という通行情報を取り出します。

判断の決まり：
- 投稿者自身が見聞きした、または明確に伝えている通行の状態だけを通行情報とする。
- 「通行止めが解除された」「開通した」「通れるようになった」は cleared。過去形の「通行止めだった」は現在の状態ではないので、解除や開通の文脈なら cleared、そうでなければ unknown。
- 疑問・推測（〜かも、〜らしい、〜そう）、他人への質問、ニュース記事の丸ごと転載、「多くの道が通行止め」のように場所が1か所に定まらないものは、location_text を空にする（is_road_report は内容に従う）。
- 「〜から〜まで通行止め」のような区間は、区間の代表となる場所（起点側の地名や施設）を location_text にし、summary に区間を書く。
- 場所の名前は本文に書かれた表記を使い、市名は付けない（例：舟戸大橋、成田湯川駅、はなのき台、中平橋）。
- lat/lng は本当に知っている場所だけ数値で答える。分からなければ null。座標を作ってはいけない。
- observed_at は本文に時刻や「今」「先ほど」「昨日の18時」などの手掛かりがあるときだけ、参考の投稿時刻から計算して ISO 8601（+09:00）で答える。無ければ null。
- 印西市周辺と関係ない地域の話なら is_road_report=false。`

function anthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  // 2026-09 から、ワークスペースに紐付かないキーは anthropic-workspace-id ヘッダーが必須になった（無いと 400）。
  // 組織「N's factory」にワークスペース「cidao」を作って ID を環境変数に置いてある（2026-09-25）
  // ID は秘密ではないので既定値を置く。環境変数に区画ID（681a0d59-…）など別の値が入っていた事故があったため、wrkspc_ で始まる値だけ採用する（2026-09-25）
  const DEFAULT_WORKSPACE_ID = 'wrkspc_01Draz5nuRYPiaBxzHMbh5Gu'
  const configured = (process.env.ANTHROPIC_WORKSPACE_ID ?? '').trim()
  const workspaceId = /^wrkspc_[A-Za-z0-9]+$/.test(configured) ? configured : DEFAULT_WORKSPACE_ID
  if (configured && workspaceId !== configured) console.warn('[disaster-sns-road-ai] ANTHROPIC_WORKSPACE_ID が wrkspc_ で始まらないため既定値を使います')
  return new Anthropic({ apiKey, defaultHeaders: { 'anthropic-workspace-id': workspaceId } })
}

export async function extractRoadReport(client: Anthropic, candidate: Candidate): Promise<{ extraction: Extraction; usage: { input: number; output: number } }> {
  const postedJst = new Date(candidate.posted_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
  const response = await client.messages.create({
    model: SNS_ROAD_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{
      role: 'user',
      content: `媒体: ${candidate.platform}\n投稿時刻（日本時間・参考）: ${postedJst}\n本文:\n${String(candidate.body_text || '').slice(0, 1500)}`,
    }],
  })
  const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text).join('')
  const extraction = JSON.parse(text) as Extraction
  return { extraction, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } }
}

type Located = { lat: number; lng: number; basis: string; byModel: boolean }

function fromPlaces(name: string): Located | null {
  const core = coreLocationName(name)
  if (!core) return null
  const hit = places.points.find((p) => p.aliases.some((a) => core.includes(coreLocationName(a)) || coreLocationName(a).includes(core)))
  return hit && inArea(hit.lat, hit.lng) ? { lat: hit.lat, lng: hit.lng, basis: hit.basis, byModel: false } : null
}

// 名前が一致しない結果は捨てる（Nominatim は範囲指定すると近い別物を返す：舟戸大橋→千葉徳洲苑 など）
async function fromNominatim(name: string, fetcher: typeof fetch): Promise<Located | null> {
  const core = coreLocationName(name)
  if (core.length < 2) return null
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&bounded=1&accept-language=ja'
    + `&viewbox=${AREA.west},${AREA.north},${AREA.east},${AREA.south}&q=${encodeURIComponent(core)}`
  const response = await fetcher(url, { headers: { 'User-Agent': 'cidao-disaster-map/1.0 (https://communitybankinzai.github.io/cbi-site/)' } })
  if (!response.ok) return null
  const rows = await response.json().catch(() => []) as Array<{ lat: string; lon: string; display_name?: string; name?: string; type?: string }>
  for (const row of rows) {
    const labels = [row.name || '', (row.display_name || '').split(',')[0]].map(coreLocationName).filter(Boolean)
    if (!labels.some((label) => label.includes(core) || core.includes(label))) continue
    const lat = Number(row.lat), lng = Number(row.lon)
    if (inArea(lat, lng)) return { lat, lng, basis: `OpenStreetMap（${row.type || '地点'}・© OpenStreetMap contributors）`, byModel: false }
  }
  return null
}

async function fromGsi(name: string, fetcher: typeof fetch): Promise<Located | null> {
  const core = coreLocationName(name)
  if (core.length < 2) return null
  const response = await fetcher(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(core)}`)
  if (!response.ok) return null
  const rows = await response.json().catch(() => []) as Array<{ geometry: { coordinates: [number, number] }; properties: { title?: string } }>
  for (const row of rows) {
    const title = coreLocationName(row.properties?.title || '')
    if (!title.includes(core)) continue
    const [lng, lat] = row.geometry.coordinates
    if (inArea(lat, lng)) return { lat, lng, basis: '国土地理院 住所検索（町名の代表点）', byModel: false }
  }
  return null
}

export async function locateRoadReport(extraction: Extraction, fetcher: typeof fetch = fetch): Promise<Located | null> {
  const name = extraction.location_text
  if (!name) return null
  const dictionary = fromPlaces(name)
  if (dictionary) return dictionary
  const osm = await fromNominatim(name, fetcher).catch(() => null)
  if (osm) return osm
  const gsi = await fromGsi(name, fetcher).catch(() => null)
  if (gsi) return gsi
  if (extraction.lat !== null && extraction.lng !== null && inArea(extraction.lat, extraction.lng)) {
    return { lat: extraction.lat, lng: extraction.lng, basis: 'AIの推定（目安・数百mずれることがあります）', byModel: true }
  }
  // 「国道464号 深草交差点付近」のように丸ごとでは見つからないとき、地名の断片（深草・草深）で町名の代表点を探す。
  // 場所が粗いので目安扱い（byModel=true で confidence は medium まで）
  for (const token of locationTokens(name)) {
    const hit = await fromGsi(token, fetcher).catch(() => null) ?? await fromNominatim(token, fetcher).catch(() => null)
    if (hit) return { ...hit, basis: `${hit.basis}・「${token}」から推定した目安`, byModel: true }
  }
  return null
}

export function locationTokens(text: string) {
  const core = coreLocationName(text)
  const parts = core.split(/[、,・/／〜~\s]|国道\d+号線?|県道\d+号線?|北千葉道路|交差点|バイパス|インター|IC|付近|方面/u).map((p) => p.trim()).filter((p) => p.length >= 2 && !/^\d+$/.test(p))
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const part of parts) {
    for (const t of [part, part.replace(/(駅|橋|大橋|台|小学校|中学校|公園)$/u, '')]) {
      if (t.length >= 2 && t !== core && !seen.has(t)) { seen.add(t); tokens.push(t) }
    }
  }
  return tokens.slice(0, 3)
}

function isDismissedOrQuote(candidate: Candidate) {
  if (candidate.review_status === 'dismissed') return true
  const raw = candidate.raw_payload || {}
  const embed = raw.embed as { $type?: string } | undefined
  return raw.is_quote_post === true || Boolean(embed?.$type?.includes('record'))
}

export type ProcessOptions = { limit?: number; since?: string; fetcher?: typeof fetch; client?: Anthropic }

// 未判定の候補を古い順に limit 件だけ AI に掛ける。巡回（5分ごと）の末尾から呼ばれるので、1回の量は小さく保つ
export async function processSnsRoadCandidates(supabase: SupabaseClient, options: ProcessOptions = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 6, 60))
  const since = options.since ?? SNS_ROAD_EVENT_START
  const fetcher = options.fetcher ?? fetch
  const { data: scanned } = await supabase.from(SNS_ROAD_SCAN_TABLE).select('candidate_id').limit(5000)
  const done = new Set((scanned ?? []).map((row) => String((row as { candidate_id: string }).candidate_id)))
  const { data: rows, error } = await supabase.from('disaster_sns_candidates')
    .select('id, platform, permalink, body_text, posted_at, review_status, raw_payload')
    .gte('posted_at', since).neq('review_status', 'dismissed').order('posted_at', { ascending: true }).limit(1500)
  if (error) throw new Error(`candidates: ${error.message}`)
  const targets = ((rows ?? []) as Candidate[]).filter((c) => !done.has(c.id) && !isDismissedOrQuote(c) && looksLikeRoadPost(c.body_text)).slice(0, limit)
  const result = { scanned: 0, reports: 0, noLocation: 0, none: 0, errors: 0, inputTokens: 0, outputTokens: 0, remaining: 0, errorSamples: [] as string[] }
  if (!targets.length) return result
  const client = options.client ?? anthropicClient()
  for (const candidate of targets) {
    result.scanned++
    let scan: { result: 'report' | 'none' | 'no_location' | 'error'; detail: string; input_tokens: number; output_tokens: number } = { result: 'error', detail: '', input_tokens: 0, output_tokens: 0 }
    try {
      const { extraction, usage } = await extractRoadReport(client, candidate)
      scan.input_tokens = usage.input; scan.output_tokens = usage.output
      result.inputTokens += usage.input; result.outputTokens += usage.output
      if (!extraction.is_road_report || extraction.kind === 'unknown') {
        scan = { ...scan, result: 'none', detail: extraction.reason.slice(0, 300) }
      } else {
        const located = await locateRoadReport(extraction, fetcher)
        if (!located) {
          scan = { ...scan, result: 'no_location', detail: `${extraction.location_text || '(場所なし)'}｜${extraction.reason}`.slice(0, 300) }
        } else {
          let confidence = extraction.confidence
          if (located.byModel && confidence === 'high') confidence = 'medium'
          const observedAt = extraction.observed_at && Number.isFinite(new Date(extraction.observed_at).getTime())
            && new Date(extraction.observed_at).getTime() <= new Date(candidate.posted_at).getTime() + 15 * 60000
            ? new Date(extraction.observed_at).toISOString() : null
          const { error: insertError } = await supabase.from(SNS_ROAD_TABLE).upsert({
            candidate_id: candidate.id, platform: candidate.platform, permalink: candidate.permalink, posted_at: candidate.posted_at,
            observed_at: observedAt, kind: extraction.kind, location_name: extraction.location_text.slice(0, 80), location_basis: located.basis,
            latitude: located.lat, longitude: located.lng, confidence, summary: extraction.summary.slice(0, 120), quote: extraction.quote.slice(0, 200),
            model: SNS_ROAD_MODEL, updated_at: new Date().toISOString(),
          }, { onConflict: 'candidate_id' })
          if (insertError) throw new Error(`report insert: ${insertError.message}`)
          scan = { ...scan, result: 'report', detail: `${extraction.kind} ${extraction.location_text} (${confidence})`.slice(0, 300) }
        }
      }
    } catch (err) {
      scan = { ...scan, result: 'error', detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) }
    }
    if (scan.result === 'report') result.reports++
    else if (scan.result === 'none') result.none++
    else if (scan.result === 'no_location') result.noLocation++
    else { result.errors++; if (result.errorSamples.length < 3) result.errorSamples.push(scan.detail) }
    // エラーは記録せず次回やり直す（API の一時障害で投稿を取り逃がさない）
    if (scan.result !== 'error') await supabase.from(SNS_ROAD_SCAN_TABLE).upsert({ candidate_id: candidate.id, ...scan }, { onConflict: 'candidate_id' })
    // Nominatim の利用規約（1秒に1回まで）
    await new Promise((resolve) => setTimeout(resolve, 1100))
  }
  result.remaining = Math.max(0, ((rows ?? []) as Candidate[]).filter((c) => !done.has(c.id) && !isDismissedOrQuote(c) && looksLikeRoadPost(c.body_text)).length - targets.length)
  return result
}

export function toPublicReport(row: Record<string, unknown>): SnsRoadReport {
  return {
    id: String(row.id), kind: row.kind as RoadKind, lat: Number(row.latitude), lng: Number(row.longitude),
    locationName: String(row.location_name ?? ''), locationBasis: String(row.location_basis ?? ''),
    observedAt: row.observed_at ? String(row.observed_at) : null, postedAt: String(row.posted_at),
    sourceUrl: String(row.permalink ?? ''), platform: String(row.platform ?? ''), confidence: row.confidence as Confidence,
    summary: String(row.summary ?? ''), quote: String(row.quote ?? ''), hidden: Boolean(row.hidden),
  }
}
