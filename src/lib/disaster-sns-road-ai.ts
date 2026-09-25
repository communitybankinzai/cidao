// SNS巡回の候補（disaster_sns_candidates）から、AI（Claude Haiku）で「通れた／通れない／解除」と場所を読み取り、
// 座標を付けて disaster_sns_road_reports に保存する。未確認情報として地図に出す前提（2026-09-25 事業主決定A）。
//
// 正規表現だけの判定は、台風25号の実データ389件で場所が決まった投稿が0件・「解除された」を「通れない」と誤判定したため、
// 文と添付写真の読み取りは AI に任せ、座標は場所の名前から「橋辞書 → OpenStreetMap Nominatim → 国土地理院 住所検索 → 名前の断片」の順に決める
// （AI が答える座標は使わない・2026-09-25 見直し。詳細は locateRoadReport）。
// 一般公開は confidence=high だけ。名前の断片で決めたときは medium までに抑える（運営パネルにだけ出る）。
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
  image_findings: string
  location_source: 'text' | 'image' | 'both' | ''
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
  imageNote: string
  embedUrl: string
  unlocated: boolean
}

// 読み直しで場所が決まらず自動で伏せた点の印（location_basis の先頭）
export const UNLOCATED_BASIS = '場所を特定できず'

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
    image_findings: { type: 'string', description: '添付写真から読み取れた場所の手掛かり（看板・駅名標・橋の名板・店名など、写っている文字）と状況（冠水・通行止めの柵など）。写真が無い・手掛かりが無いときは空文字。推測で地名を足さない' },
    location_source: { type: 'string', enum: ['text', 'image', 'both', ''], description: 'location_text の根拠。本文だけ=text、写真に写った文字だけ=image、両方=both、場所なし=空' },
    observed_at: { type: ['string', 'null'], description: '投稿者がその状況を見た日時（ISO 8601・日本時間 +09:00）。本文に時刻や「今」「昨日18時」などの手掛かりがあるときだけ。無ければ null。投稿時刻で埋めない' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high=特定の1か所と状態が本文にはっきり書かれ、投稿者自身の見聞。medium=場所が地区・町名程度、または人づて・公式発表の転記。low=推測や曖昧' },
    summary: { type: 'string', description: '地図の吹き出しに出す1文（40字以内・敬体不要・例：国道464号の台方〜北須賀が冠水で通行止め）' },
    quote: { type: 'string', description: '判断の根拠になった本文の一節（そのまま・80字以内）' },
    reason: { type: 'string', description: '判定理由（短く）' },
  },
  required: ['is_road_report', 'kind', 'location_text', 'location_kind', 'image_findings', 'location_source', 'observed_at', 'confidence', 'summary', 'quote', 'reason'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `あなたは千葉県印西市とその周辺（成田市・白井市・佐倉市・栄町）の防災マップの係です。
SNSの投稿1件を読み、「特定の道・橋・場所が 通れた／通れない／通行止めが解除された」という通行情報を取り出します。

判断の決まり：
- 投稿者自身が見聞きした、または明確に伝えている通行の状態だけを通行情報とする。
- 「通行止めが解除された」「開通した」「通れるようになった」は cleared。過去形の「通行止めだった」は現在の状態ではないので、解除や開通の文脈なら cleared、そうでなければ unknown。
- 疑問・推測（〜かも、〜らしい、〜そう）、他人への質問、ニュース記事の丸ごと転載、「多くの道が通行止め」のように場所が1か所に定まらないものは、location_text を空にする（is_road_report は内容に従う）。
- 「〜から〜まで通行止め」のような区間は、区間の代表となる場所を location_text にし、summary に区間を書く。
- location_text を道路名だけ（「国道464号」など）にしない。本文に駅・橋・交差点・施設・町名が出てくれば、道路名に添えて必ず含める（例：「国道464号 成田湯川駅付近」「北千葉道路 北須賀交差点」）。
- 場所の名前は本文に書かれた表記を使い、市名は付けない（例：舟戸大橋、成田湯川駅、はなのき台、中平橋）。
- 写真が添付されていたら必ず見る。看板・駅名標・橋の名板・交差点名の標識・店名など、写っている文字は場所の手掛かりとして image_findings に書き写す。
- 本文の場所が「国道464号」「印旛沼周辺」のように広いとき、写真の文字でもっと狭い場所（駅・橋・交差点・施設）が分かれば、それを location_text にする。
- 写真の文字が本文の場所と食い違うときは本文を優先し、reason に食い違いを書く。写真の風景だけから地名を推測してはいけない（文字として写っているものだけ）。
- 座標は答えない。場所の名前だけを答える。
- observed_at は本文に時刻や「今」「先ほど」「昨日の18時」などの手掛かりがあるときだけ、参考の投稿時刻から計算して ISO 8601（+09:00）で答える。無ければ null。
- 印西市周辺と関係ない地域の話なら is_road_report=false。`

// ワークスペースの扱い（2026-09-25）：
// 手元のキーは「anthropic-workspace-id ヘッダーが必須」と 400 を返すが、本番（Vercel）のキーはヘッダー無しで通り、
// 逆にヘッダーを付けると「Workspace not found」404 になった（キーの組織が違う）。
// そのため既定はヘッダー無しで呼び、「指定必須」と言われたときだけ付けて1回やり直す。
// ID は秘密ではないので既定値を置く。環境変数に区画ID（681a0d59-…）が入っていた事故があるため wrkspc_ で始まる値だけ採用する
const DEFAULT_WORKSPACE_ID = 'wrkspc_01Draz5nuRYPiaBxzHMbh5Gu'
function workspaceId() {
  const configured = (process.env.ANTHROPIC_WORKSPACE_ID ?? '').trim()
  return /^wrkspc_[A-Za-z0-9]+$/.test(configured) ? configured : DEFAULT_WORKSPACE_ID
}
export function anthropicClient(withWorkspace = false) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey, defaultHeaders: withWorkspace ? { 'anthropic-workspace-id': workspaceId() } : undefined })
}
export function needsWorkspaceHeader(error: unknown) {
  return error instanceof Anthropic.APIError && error.status === 400 && /anthropic-workspace-id/.test(error.message)
}

// 投稿に添付された写真のアドレス（最大2枚）。Instagram は写真・複数枚の1枚目（media_url）、Bluesky は画像の fullsize。
// 動画（Instagram のリール）は media_url が動画なので使わない。Bluesky のリンクカードの画像は記事の画像で現地の写真ではないので使わない
export function mediaImageUrls(candidate: Pick<Candidate, 'platform' | 'raw_payload'>): string[] {
  const raw = (candidate.raw_payload || {}) as Record<string, unknown>
  if (candidate.platform === 'instagram') {
    const type = String(raw.media_type || '')
    return (type === 'IMAGE' || type === 'CAROUSEL_ALBUM') && typeof raw.media_url === 'string' ? [raw.media_url] : []
  }
  if (candidate.platform === 'bluesky') {
    const embed = (raw.embed || {}) as { images?: Array<{ fullsize?: string }>; media?: { images?: Array<{ fullsize?: string }> } }
    const images = embed.images ?? embed.media?.images ?? []
    return images.map((image) => image.fullsize || '').filter((u) => /^https:\/\/cdn\.bsky\.app\//.test(u)).slice(0, 2)
  }
  return []
}

// 公式の埋め込み表示のアドレス（2026-09-25 事業主決定：写真は転載せず、投稿者が消せば地図からも消える公式の埋め込みで出す）
export function embedUrlOf(candidate: Pick<Candidate, 'platform' | 'permalink' | 'raw_payload'>): string {
  const raw = (candidate.raw_payload || {}) as Record<string, unknown>
  if (candidate.platform === 'instagram') {
    const m = String(candidate.permalink || '').match(/^https:\/\/www\.instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)
    return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed/` : ''
  }
  if (candidate.platform === 'bluesky') {
    const m = String(raw.uri || '').match(/^at:\/\/(did:[a-z0-9:._-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9]+)$/i)
    return m ? `https://embed.bsky.app/embed/${m[1]}/app.bsky.feed.post/${m[2]}` : ''
  }
  return ''
}

type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } }
// 画像は自前で取ってから base64 で渡す（Instagram の CDN は署名付きで、Anthropic 側からの取得が通らないことがある）。取れなければ本文だけで判定する
async function loadImages(urls: string[], fetcher: typeof fetch): Promise<ImageBlock[]> {
  const blocks: ImageBlock[] = []
  for (const url of urls) {
    try {
      const response = await fetcher(url)
      if (!response.ok) continue
      const type = (response.headers.get('content-type') || '').split(';')[0].trim()
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) continue
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > 4.5 * 1024 * 1024) continue
      blocks.push({ type: 'image', source: { type: 'base64', media_type: type as ImageBlock['source']['media_type'], data: buffer.toString('base64') } })
    } catch { /* 期限切れのアドレスなど。本文だけで続ける */ }
  }
  return blocks
}

// model：既定は SNS_ROAD_MODEL。モデル比較（scripts/compare-sns-road-models.ts）のときだけ別のモデルを渡す。
// Haiku 4.5 は effort を受け付けないので、effort は Haiku 以外のときだけ付ける
export async function extractRoadReport(client: Anthropic, candidate: Candidate, fetcher: typeof fetch = fetch, model: string = SNS_ROAD_MODEL, effort?: 'low' | 'medium' | 'high'): Promise<{ extraction: Extraction; usage: { input: number; output: number }; imageCount: number }> {
  const postedJst = new Date(candidate.posted_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
  const images = await loadImages(mediaImageUrls(candidate), fetcher)
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA }, ...(effort && !model.includes('haiku') ? { effort } : {}) },
    messages: [{
      role: 'user',
      content: [
        ...images,
        { type: 'text', text: `媒体: ${candidate.platform}\n添付写真: ${images.length}枚\n投稿時刻（日本時間・参考）: ${postedJst}\n本文:\n${String(candidate.body_text || '').slice(0, 1500)}` },
      ],
    }],
  })
  const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text).join('')
  const extraction = JSON.parse(text) as Extraction
  return { extraction, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }, imageCount: images.length }
}

type Located = { lat: number; lng: number; basis: string; byModel: boolean }

// 辞書の名前が本文の場所名に丸ごと含まれるときだけ採る（逆向きの部分一致は「国道」→「北80-3地先(国道356号…)」のような誤一致を生んだ）
function fromPlaces(name: string): Located | null {
  const core = coreLocationName(name)
  if (core.length < 2) return null
  const hit = places.points.find((p) => p.aliases.some((a) => { const alias = coreLocationName(a); return alias.length >= 3 && core.includes(alias) }))
  return hit && inArea(hit.lat, hit.lng) ? { lat: hit.lat, lng: hit.lng, basis: hit.basis, byModel: false } : null
}

// 1点に決められない場所の名前（道路名だけ・沼・川・市町村・広い地域）。これしか無い投稿は地図に置かない（2026-09-25 事業主指摘：
// 「国道464号」「北千葉道路」が道路上の遠い1点に、「印旛沼」が沼の中心に置かれ、投稿の場所と数km違っていた）
const WIDE_AREA = /^(国道|県道|市道|道路|北千葉道路|(国道|県道)\d+号線?|印旛沼|北印旛沼|西印旛沼|手賀沼|利根川|印旛放水路|新川|千葉ニュータウン|ニュータウン|北総|印西|白井|成田|佐倉|栄町|酒々井|印西市|白井市|成田市|佐倉市|市内|市街地?)(の)?(全域|全体|沿い|周辺|付近|一帯|各地|あたり)?$/u
export function isWideArea(text: string) {
  const core = coreLocationName(text).replace(/(周辺|付近|一帯|沿い|全域)$/u, '')
  // 「本埜バイパス」「成田街道」など、名前の付いた道路そのものも1点に決められない
  return WIDE_AREA.test(core) || /(バイパス|街道|道路|通り|線)$/u.test(core)
}
// 駅・橋・交差点などの目印。道路名と一緒に書かれていても、こちらを先に探す
const LANDMARK = /(駅|大橋|橋|交差点|トンネル|隧道|アンダーパス|小学校|中学校|高校|公園|IC|インター|病院|役所|市役所|センター)$/u

// 名前が一致しない結果は捨てる（Nominatim は範囲指定すると近い別物を返す：舟戸大橋→千葉徳洲苑 など）
async function fromNominatim(name: string, fetcher: typeof fetch): Promise<Located | null> {
  const core = coreLocationName(name)
  if (core.length < 2) return null
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&bounded=1&accept-language=ja'
    + `&viewbox=${AREA.west},${AREA.north},${AREA.east},${AREA.south}&q=${encodeURIComponent(core)}`
  const response = await fetcher(url, { headers: { 'User-Agent': 'cidao-disaster-map/1.0 (https://communitybankinzai.github.io/cbi-site/)' } })
  if (!response.ok) return null
  const rows = await response.json().catch(() => []) as Array<{ lat: string; lon: string; display_name?: string; name?: string; type?: string; category?: string; addresstype?: string }>
  for (const row of rows) {
    // 沼・川・市町村のような面や線の代表点は、投稿の場所から数km離れうるので採らない。
    // 道路（highway）は橋・交差点など目印の名前で当たったときだけ採る（道路名だけだと道路上の遠い1点になる）
    if (['natural', 'waterway', 'boundary', 'landuse'].includes(row.category || '')) continue
    if (['city', 'town', 'village', 'county', 'state', 'province', 'municipality', 'administrative'].includes(row.addresstype || row.type || '')) continue
    if (row.category === 'highway' && !LANDMARK.test(core)) continue
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

// 場所の決め方（2026-09-25 見直し）：
// 1. 道路名・沼・市町村などの広い名前だけなら置かない
// 2. 丸ごとの名前で 辞書 → OpenStreetMap → 国土地理院
// 3. 見つからなければ断片（「国道464号 成田湯川駅付近」→「成田湯川駅」）で探す。駅・橋・交差点などの目印を先に。目安扱い（confidence は medium まで）
// AI が答えた座標は使わない（成田湯川駅を約5km、手賀大橋を印西市内に置いていた）
export async function locateRoadReport(extraction: Pick<Extraction, 'location_text'>, fetcher: typeof fetch = fetch): Promise<Located | null> {
  const name = extraction.location_text
  if (!name || isWideArea(name)) return null
  const dictionary = fromPlaces(name)
  if (dictionary) return dictionary
  const osm = await fromNominatim(name, fetcher).catch(() => null)
  if (osm) return osm
  const gsi = await fromGsi(name, fetcher).catch(() => null)
  if (gsi) return gsi
  // 目印（駅・橋…）の断片は辞書と OpenStreetMap、それ以外の断片は町名（国土地理院）だけで探す
  // （「本埜バイパス」の「本埜」が OpenStreetMap で小学校に当たった）
  for (const token of locationTokens(name)) {
    if (isWideArea(token)) continue
    const hit = LANDMARK.test(token)
      ? fromPlaces(token) ?? await fromNominatim(token, fetcher).catch(() => null)
      : await fromGsi(token, fetcher).catch(() => null)
    if (hit) return { ...hit, basis: `${hit.basis}・「${token}」から推定した目安`, byModel: true }
  }
  return null
}

export function locationTokens(text: string) {
  const core = coreLocationName(text)
  const parts = core.split(/[、,・/／〜~\s]|国道\d+号線?|県道\d+号線?|北千葉道路|交差点|バイパス|インター|IC|付近|方面/u).map((p) => p.trim()).filter((p) => p.length >= 2 && !/^\d+$/.test(p))
  const seen = new Set<string>()
  const tokens: string[] = []
  // 目印（駅・橋・交差点…）の断片を先に。語尾を削った形（手賀大橋→手賀）は別の町に当たるので使わない
  const ordered = [...parts.filter((p) => LANDMARK.test(p)), ...parts.filter((p) => !LANDMARK.test(p))]
  for (const t of ordered) {
    if (t.length >= 2 && t !== core && !seen.has(t)) { seen.add(t); tokens.push(t) }
  }
  return tokens.slice(0, 4)
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
  let client = options.client ?? anthropicClient()
  for (const candidate of targets) {
    result.scanned++
    let scan: { result: 'report' | 'none' | 'no_location' | 'error'; detail: string; input_tokens: number; output_tokens: number } = { result: 'error', detail: '', input_tokens: 0, output_tokens: 0 }
    try {
      let extracted: Awaited<ReturnType<typeof extractRoadReport>>
      try {
        extracted = await extractRoadReport(client, candidate, fetcher)
      } catch (firstError) {
        if (!needsWorkspaceHeader(firstError) || options.client) throw firstError
        // 「ワークスペース指定が必須」と言われたキー（手元用など）だけヘッダー付きに切り替えて、以降もそれを使う
        client = anthropicClient(true)
        extracted = await extractRoadReport(client, candidate, fetcher)
      }
      const { extraction, usage, imageCount } = extracted
      scan.input_tokens = usage.input; scan.output_tokens = usage.output
      result.inputTokens += usage.input; result.outputTokens += usage.output
      const imageNote = imageCount ? extraction.image_findings.trim().slice(0, 200) : ''
      const located = !extraction.is_road_report || extraction.kind === 'unknown' ? null : await locateRoadReport(extraction, fetcher)
      if (!extraction.is_road_report || extraction.kind === 'unknown' || !located) {
        scan = !extraction.is_road_report || extraction.kind === 'unknown'
          ? { ...scan, result: 'none', detail: extraction.reason.slice(0, 300) }
          : { ...scan, result: 'no_location', detail: `${extraction.location_text || '(場所なし)'}｜${extraction.reason}`.slice(0, 300) }
        // 読み直し（rescan）で場所が決まらなくなった既存の点は伏せる。データは残し、運営の一覧に「場所を特定できず」と出す（2026-09-25 事業主決定）
        await supabase.from(SNS_ROAD_TABLE).update({
          hidden: true, location_basis: `${UNLOCATED_BASIS}（${scan.result === 'none' ? '通行情報でない' : extraction.location_text || '場所なし'}）`,
          image_note: imageNote, updated_at: new Date().toISOString(),
        }).eq('candidate_id', candidate.id)
      } else {
        let confidence = extraction.confidence
        if (located.byModel && confidence === 'high') confidence = 'medium'
        const observedAt = extraction.observed_at && Number.isFinite(new Date(extraction.observed_at).getTime())
          && new Date(extraction.observed_at).getTime() <= new Date(candidate.posted_at).getTime() + 15 * 60000
          ? new Date(extraction.observed_at).toISOString() : null
        const fromImage = extraction.location_source === 'image' || extraction.location_source === 'both'
        const { data: existing } = await supabase.from(SNS_ROAD_TABLE).select('hidden, location_basis').eq('candidate_id', candidate.id).maybeSingle()
        const row: Record<string, unknown> = {
          candidate_id: candidate.id, platform: candidate.platform, permalink: candidate.permalink, posted_at: candidate.posted_at,
          observed_at: observedAt, kind: extraction.kind, location_name: extraction.location_text.slice(0, 80),
          location_basis: `${located.basis}${fromImage ? '・場所名は写真に写った文字から' : ''}`,
          latitude: located.lat, longitude: located.lng, confidence, summary: extraction.summary.slice(0, 120), quote: extraction.quote.slice(0, 200),
          image_note: imageNote, embed_url: embedUrlOf(candidate), model: SNS_ROAD_MODEL, updated_at: new Date().toISOString(),
        }
        // 自動で伏せた点だけ戻す。運営が手で伏せたものはそのまま
        if (existing && String(existing.location_basis || '').startsWith(UNLOCATED_BASIS)) row.hidden = false
        const { error: insertError } = await supabase.from(SNS_ROAD_TABLE).upsert(row, { onConflict: 'candidate_id' })
        if (insertError) throw new Error(`report insert: ${insertError.message}`)
        scan = { ...scan, result: 'report', detail: `${extraction.kind} ${extraction.location_text} (${confidence})${imageCount ? ` 写真${imageCount}枚` : ''}`.slice(0, 300) }
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
    imageNote: String(row.image_note ?? ''), embedUrl: String(row.embed_url ?? ''),
    unlocated: String(row.location_basis ?? '').startsWith(UNLOCATED_BASIS),
  }
}
