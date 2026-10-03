// FreeFree × OpenPOI 一括登録の純粋ロジック（DB・ネットワークに依存しない部分）。
//
// 他のモジュールを import しないこと。node の組み込みテストランナーが
// 型除去だけで直接読めるようにするため（src/lib/__tests__/freefree-import-core.test.mts）。
//
// OpenPOI API の仕様（https://docs.openpoiapi.com/ 2026-10-02 確認）:
//   ・GET /v1/search  q / center+radius / bbox / limit(1〜200)。ページ送り(offset)は無い
//   ・応答に固有ID・電話・URL・営業時間は無い。name/address/lat/lng/category/licenses/attributions など
//   ・lat/lng は座標が無いとき空文字
//   ・API 全体で定常 200 req/s（利用者ごとの制限なし）。それでも節度を持って叩く

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type OpenpoiFacility = {
  name?: string
  name_kana?: string
  prefecture?: string
  city?: string
  address?: string
  category?: string
  business_type?: string
  lat?: number | string
  lng?: number | string
  level?: number | string | null
  source?: string
  licenses?: string[]
  attributions?: string[]
}

/** [minLng, minLat, maxLng, maxLat] */
export type Bbox = [number, number, number, number]

export type CandidateDraft = {
  source: 'openpoi'
  source_id: string
  name: string
  name_kana: string | null
  prefecture: string | null
  city: string | null
  address: string | null
  latitude: number
  longitude: number
  geocode_level: number | null
  openpoi_category: string | null
  business_type: string | null
  openpoi_source: string | null
  licenses: string[]
  attributions: string[]
  raw_data: OpenpoiFacility
  content_hash: string
  category: FreefreeCategoryKey | null
  category_reason: string
}

export type FreefreeCategoryKey =
  | 'food' | 'retail' | 'education' | 'craft' | 'living' | 'startup' | 'event' | 'volunteer'

export type DuplicateStatus = 'none' | 'possible' | 'duplicate'

// ---------------------------------------------------------------------------
// 地域
// ---------------------------------------------------------------------------

export type Region = {
  key: string
  label: string
  prefecture: string
  city: string
  bbox: Bbox
}

/** 初期地域。bbox は市域より少し広め（隣接市は city で絞り込む） */
export const REGIONS: Region[] = [
  { key: 'chiba-inzai', label: '千葉県印西市', prefecture: '千葉県', city: '印西市', bbox: [140.07, 35.73, 140.28, 35.87] },
]

export function regionKeyFor(prefecture: string, city: string): string {
  const preset = REGIONS.find((r) => r.prefecture === prefecture && r.city === city)
  return preset?.key ?? `custom:${prefecture}${city}`
}

export function isValidBbox(b: unknown): b is Bbox {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  const [minLng, minLat, maxLng, maxLat] = b as number[]
  return minLng < maxLng && minLat < maxLat && minLat >= -90 && maxLat <= 90 && minLng >= -180 && maxLng <= 180
}

/** 取得を許す範囲の上限（誤入力で日本中を叩かない）。約 0.6°×0.5° ≒ 50km × 55km */
export const MAX_BBOX_SPAN: [number, number] = [0.6, 0.5]

export function bboxWithinLimit(b: Bbox): boolean {
  return b[2] - b[0] <= MAX_BBOX_SPAN[0] && b[3] - b[1] <= MAX_BBOX_SPAN[1]
}

/** center(lat,lng)+radius(m) を bbox に直す（OpenPOI の center は経度が先だが、こちらは人間向けに lat,lng） */
export function bboxFromCenter(lat: number, lng: number, radiusM: number): Bbox {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
}

// ---------------------------------------------------------------------------
// ハッシュ・文字列の正規化
// ---------------------------------------------------------------------------

/** cyrb53（非暗号・53bit）。差分検知と source_id の生成に使う */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

const DASHES = /[-‐-―−ー－─]/g // ハイフン類（長音「ー」は別扱いにするため下で戻す）

/** ひらがな→カタカナ（比較用） */
function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

const CORP_FORMS = [
  '株式会社', '(株)', '有限会社', '(有)', '合同会社', '(合)', '合資会社', '(資)',
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人', '医療法人社団', '医療法人財団', '医療法人',
  '社会福祉法人', '特定非営利活動法人', 'npo法人', '学校法人', '宗教法人',
]

/** 支店を表す接尾（地域名＋店）。「印西店」「印西市店」「千葉ニュータウン店」など */
const BRANCH_PLACES = ['印西市', '印西', '千葉ニュータウン', '千葉ニュータウン中央', '千葉nt', '牧の原', '印旛日本医大', '木下', '小林', '船橋']
const BRANCH_SUFFIX = new RegExp(`(?:${BRANCH_PLACES.join('|')})店$`)

/**
 * 店名の比較キーを作る。
 * [0] = 全体を正規化したもの、[1] = 法人格・かっこ書き・地域支店名を除いたもの（2文字未満なら作らない）
 */
export function nameKeys(raw: string): string[] {
  const full = baseNormalize(raw)
  if (!full) return []
  let stripped = full
  for (const f of CORP_FORMS) stripped = stripped.split(baseNormalize(f)).join('')
  stripped = stripped.replace(/\([^)]*\)/g, '').replace(/[()（）]/g, '')
  stripped = stripped.replace(BRANCH_SUFFIX, '')
  const keys = [full.replace(/[()（）]/g, '')]
  if (stripped.length >= 2 && stripped !== keys[0]) keys.push(stripped)
  return keys
}

function baseNormalize(raw: string): string {
  let s = (raw ?? '').normalize('NFKC').toLowerCase()
  s = toKatakana(s)
  // 長音「ー」は残し、その他のハイフン類・空白・中黒・記号を除く
  s = s.replace(DASHES, (c) => (c === 'ー' ? 'ー' : ''))
  s = s.replace(/[\s　・･·.,，、。'’"“”!！?？&＆~〜]/g, '')
  return s
}

const KANJI_DIGITS: Record<string, string> = { 〇: '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }

function kanjiNumberToArabic(s: string): string {
  // 十の位まで（地番・丁目で十分）
  return s.replace(/[〇一二三四五六七八九十]+(?=丁目|番地|番|号|の|−|-|$)/g, (m) => {
    if (m === '十') return '10'
    if (m.includes('十')) {
      const [a, b] = m.split('十')
      const tens = a ? Number(KANJI_DIGITS[a] ?? 0) : 1
      const ones = b ? Number(KANJI_DIGITS[b] ?? 0) : 0
      return String(tens * 10 + ones)
    }
    return m.split('').map((c) => KANJI_DIGITS[c] ?? c).join('')
  })
}

/**
 * 住所の比較キー。都道府県・郵便番号・建物名を落とし、番地までを「市区町村+町名+数字-数字」にそろえる。
 * 数字を含まない住所（市区町村名だけ等）は特定力が無いので空文字を返す。
 */
export function addressKey(raw: string | null | undefined): string {
  let s = (raw ?? '').normalize('NFKC')
  s = s.replace(/^日本[、,\s]*/, '').replace(/〒?\s*\d{3}-?\d{4}\s*/, '')
  s = s.replace(/^(?:千葉県|東京都|北海道|(?:京都|大阪)府|.{2,3}県)/, '')
  s = kanjiNumberToArabic(s)
  s = s.replace(/\s+/g, '')
  s = s.replace(/丁目|番地の?|番|号|の|[‐-―−ー－]/g, '-')
  s = s.replace(/-+/g, '-')
  const m = s.match(/^(.*?\d+(?:-\d+)*)/)
  if (!m) return ''
  return m[1].replace(/-$/, '')
}

export function normalizePhone(raw: string | null | undefined): string {
  const d = (raw ?? '').normalize('NFKC').replace(/\D/g, '')
  return d.length >= 9 && d.length <= 11 ? d : ''
}

export function websiteHost(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// OpenPOI → 候補
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** OpenPOI に固有IDが無いので、正規化した名称+座標（小数5桁≒1m）から安定IDを作る */
export function makeSourceId(name: string, lat: number, lng: number): string {
  return `opoi-${hash53(`${baseNormalize(name)}|${lat.toFixed(5)}|${lng.toFixed(5)}`)}`
}

export function contentHashOf(f: { name: string; address: string | null; category: string | null; business_type: string | null; licenses: string[]; attributions: string[]; prefecture: string | null; city: string | null }): string {
  return hash53(JSON.stringify([f.name, f.address, f.category, f.business_type, f.prefecture, f.city, [...f.licenses].sort(), [...f.attributions].sort()]))
}

/** 取り込めない（名称・座標なし）ときは null */
export function toCandidateDraft(f: OpenpoiFacility): CandidateDraft | null {
  const name = str(f.name)
  const lat = toNum(f.lat)
  const lng = toNum(f.lng)
  if (!name || lat === null || lng === null) return null
  const cat = mapCategory(str(f.category), str(f.business_type), name)
  const licenses = strArray(f.licenses)
  const attributions = strArray(f.attributions)
  const base = {
    name,
    address: str(f.address),
    category: str(f.category),
    business_type: str(f.business_type),
    prefecture: str(f.prefecture),
    city: str(f.city),
    licenses,
    attributions,
  }
  return {
    source: 'openpoi',
    source_id: makeSourceId(name, lat, lng),
    name,
    name_kana: str(f.name_kana),
    prefecture: base.prefecture,
    city: base.city,
    address: base.address,
    latitude: lat,
    longitude: lng,
    geocode_level: toNum(f.level),
    openpoi_category: base.category,
    business_type: base.business_type,
    openpoi_source: str(f.source),
    licenses,
    attributions,
    raw_data: f,
    content_hash: contentHashOf(base),
    category: cat.key,
    category_reason: cat.reason,
  }
}

/** 対象市区町村に属するか。city が空のときは住所に市名が入っているものだけ通す */
export function inTargetCity(f: OpenpoiFacility, city: string): boolean {
  const c = (f.city ?? '').normalize('NFKC').trim()
  if (c) return c === city
  return (f.address ?? '').normalize('NFKC').includes(city)
}

// ---------------------------------------------------------------------------
// カテゴリー変換
// ---------------------------------------------------------------------------

/** OpenPOI の category 語彙（2026-10-02 に印西市で確認した分＋想定語）→ FreeFree カテゴリー */
const CATEGORY_MAP: Record<string, FreefreeCategoryKey> = {
  restaurant: 'food', cafe: 'food', bakery: 'food', fast_food: 'food', bar_izakaya: 'food',
  sweets: 'food', confectionery: 'food', food_other: 'food',
  retail_other: 'retail', grocery: 'retail', convenience: 'retail', supermarket: 'retail',
  drugstore: 'retail', shopping: 'retail', department_store: 'retail',
  education: 'education', school: 'education', cram_school: 'education',
  medical: 'living', lodging: 'living', tourism: 'living', public_facility: 'living',
  service_other: 'living', beauty: 'living', welfare: 'living', childcare: 'living', finance: 'living',
}

/** category が unknown / 未知のときの名称ヒント。強い語だけ（誤分類より未分類を選ぶ） */
const NAME_HINTS: [RegExp, FreefreeCategoryKey][] = [
  [/(カフェ|珈琲|コーヒー|喫茶|ラーメン|食堂|レストラン|居酒屋|寿司|焼肉|うどん|そば|パン|ベーカリー|ケーキ|弁当)/, 'food'],
  [/(学習塾|進学塾|教室|スクール|予備校|幼稚園|保育園|こども園|学院|アカデミー)/, 'education'],
  [/(クリニック|医院|歯科|病院|薬局|整骨|接骨|美容室|理容|サロン|ホテル|旅館)/, 'living'],
  [/(ストア|ショップ|マート|スーパー|ドラッグ|書店|ホームセンター)/, 'retail'],
]

export function mapCategory(
  category: string | null,
  businessType: string | null,
  name: string,
): { key: FreefreeCategoryKey | null; reason: string } {
  const c = (category ?? '').toLowerCase()
  if (c && CATEGORY_MAP[c]) return { key: CATEGORY_MAP[c], reason: `OpenPOI category「${c}」から変換` }
  const b = (businessType ?? '').toLowerCase()
  if (b && b !== c && CATEGORY_MAP[b]) return { key: CATEGORY_MAP[b], reason: `OpenPOI business_type「${b}」から変換` }
  for (const [re, key] of NAME_HINTS) {
    if (re.test(name)) return { key, reason: `名称の語から推定（OpenPOI category: ${c || 'なし'}）` }
  }
  return { key: null, reason: `未分類（OpenPOI category: ${c || 'なし'}）` }
}

/** 管理画面表示用の業種ラベル */
export function openpoiCategoryLabel(c: string | null | undefined): string {
  const map: Record<string, string> = {
    restaurant: '飲食店', cafe: 'カフェ', bakery: 'パン・菓子', fast_food: 'ファストフード', bar_izakaya: '居酒屋・バー',
    retail_other: '小売', grocery: '食料品店', convenience: 'コンビニ', education: '教育', medical: '医療',
    lodging: '宿泊', tourism: '観光', public_facility: '公共施設', service_other: 'サービス', unknown: '不明',
  }
  const k = (c ?? '').toLowerCase()
  return map[k] ?? (c || '不明')
}

// ---------------------------------------------------------------------------
// 重複判定
// ---------------------------------------------------------------------------

export type DedupRecord = {
  kind: 'post' | 'candidate'
  id: string
  name: string
  address: string | null
  lat: number | null
  lon: number | null
  phone?: string | null
  website?: string | null
}

export type DedupQuery = {
  /** 自分自身（再取得した候補）を除外するための候補ID */
  selfId?: string | null
  name: string
  address: string | null
  lat: number | null
  lon: number | null
  phone?: string | null
  website?: string | null
}

export type DedupResult = {
  status: DuplicateStatus
  reason: string | null
  matchKind: 'post' | 'candidate' | null
  matchId: string | null
}

const NONE: DedupResult = { status: 'none', reason: null, matchKind: null, matchId: null }

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 座標が近い（同じ建物・同じ区画）とみなす距離 */
export const NEAR_M = 150

const GRID = 0.0025 // 約 280m（緯度）/ 230m（経度・印西）

export class DedupIndex {
  private byName = new Map<string, DedupRecord[]>()
  private byGrid = new Map<string, DedupRecord[]>()
  private byPhone = new Map<string, DedupRecord[]>()
  private byHost = new Map<string, DedupRecord[]>()
  private keysOf = new Map<DedupRecord, string[]>()

  constructor(records: DedupRecord[] = []) {
    for (const r of records) this.add(r)
  }

  add(r: DedupRecord) {
    const keys = nameKeys(r.name)
    this.keysOf.set(r, keys)
    for (const k of keys) push(this.byName, k, r)
    if (r.lat !== null && r.lon !== null) push(this.byGrid, cell(r.lat, r.lon), r)
    const p = normalizePhone(r.phone)
    if (p) push(this.byPhone, p, r)
    const h = websiteHost(r.website)
    if (h) push(this.byHost, h, r)
  }

  judge(q: DedupQuery): DedupResult {
    const keys = nameKeys(q.name)
    const myAddr = addressKey(q.address)
    const hasPos = q.lat !== null && q.lon !== null
    const sameName = new Set<DedupRecord>()
    for (const k of keys) for (const r of this.byName.get(k) ?? []) if (r.id !== q.selfId) sameName.add(r)

    // 2. 名称＋住所一致
    if (myAddr) {
      for (const r of sameName) {
        if (addressKey(r.address) === myAddr) return hit('duplicate', '名称と住所が一致', r)
      }
    }
    // 4. 名称＋電話番号
    const phone = normalizePhone(q.phone)
    if (phone) {
      for (const r of this.byPhone.get(phone) ?? []) {
        if (r.id !== q.selfId && sameName.has(r)) return hit('duplicate', '名称と電話番号が一致', r)
      }
    }
    // 3. 名称＋座標が近い
    if (hasPos) {
      let best: { r: DedupRecord; d: number } | null = null
      for (const r of sameName) {
        if (r.lat === null || r.lon === null) continue
        const d = distanceM(q.lat!, q.lon!, r.lat, r.lon)
        if (d <= NEAR_M && (!best || d < best.d)) best = { r, d }
      }
      if (best) return hit('possible', `名称が一致し、位置が約${Math.round(best.d)}m以内`, best.r)
    }
    // 5. 名称＋Webサイト
    const host = websiteHost(q.website)
    if (host) {
      for (const r of this.byHost.get(host) ?? []) {
        if (r.id !== q.selfId && sameName.has(r)) return hit('possible', '名称とWebサイトのドメインが一致', r)
      }
    }
    // 名称の部分一致（片方が他方に含まれる・4文字以上）＋座標が近い。表記揺れの取りこぼし対策
    if (hasPos) {
      const near = this.nearby(q.lat!, q.lon!)
      for (const r of near) {
        if (r.id === q.selfId || r.lat === null || r.lon === null) continue
        if (distanceM(q.lat!, q.lon!, r.lat, r.lon) > NEAR_M) continue
        if (namesOverlap(keys, this.keysOf.get(r) ?? [])) return hit('possible', '名称が似ていて、位置が近い', r)
      }
    }
    return NONE
  }

  private nearby(lat: number, lon: number): DedupRecord[] {
    const out: DedupRecord[] = []
    const gy = Math.floor(lat / GRID)
    const gx = Math.floor(lon / GRID)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const r of this.byGrid.get(`${gy + dy}:${gx + dx}`) ?? []) out.push(r)
      }
    }
    return out
  }
}

function cell(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID)}:${Math.floor(lon / GRID)}`
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

function hit(status: DuplicateStatus, reason: string, r: DedupRecord): DedupResult {
  return { status, reason, matchKind: r.kind, matchId: r.id }
}

function namesOverlap(a: string[], b: string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      const [s, l] = x.length <= y.length ? [x, y] : [y, x]
      if (s.length >= 4 && l.includes(s)) return true
    }
  }
  return false
}

/** 既存の FreeFree 投稿（本文から電話番号を拾う）を重複判定の対象にする */
export function postToDedupRecord(p: {
  id: string
  title: string
  body?: string | null
  address?: string | null
  location?: string | null
  lat?: number | null
  lon?: number | null
  links?: { url?: string }[] | null
}): DedupRecord {
  const phoneMatch = (p.body ?? '').normalize('NFKC').match(/0\d{1,4}-?\d{1,4}-?\d{3,4}/)
  const firstUrl = Array.isArray(p.links) ? p.links.find((l) => l?.url)?.url ?? null : null
  return {
    kind: 'post',
    id: p.id,
    name: p.title,
    address: p.address ?? p.location ?? null,
    lat: p.lat ?? null,
    lon: p.lon ?? null,
    phone: phoneMatch ? phoneMatch[0] : null,
    website: firstUrl,
  }
}

// ---------------------------------------------------------------------------
// bbox 分割取得（OpenPOI は1回200件まで・ページ送りが無い）
// ---------------------------------------------------------------------------

export const SEARCH_LIMIT = 200

/** OpenPOI の出典・ライセンスページ（画面に出すときのリンク先） */
export const OPENPOI_ATTRIBUTION_URL = 'https://openpoiapi.com/attribution.html'

export type CollectOptions = {
  maxRequests?: number   // 1回の取得で叩く回数の上限
  maxDepth?: number      // 分割の深さ
  concurrency?: number   // 同時に投げる数（OpenPOI は定常200req/sまで。控えめに4）
  delayMs?: number       // 次の一括リクエストまでの間隔
  deadlineAt?: number    // この時刻(ms)を過ぎたら打ち切る
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export type CollectResult = {
  facilities: OpenpoiFacility[]
  requests: number
  /** 200件に達したまま分割できなかった区画の数（取りこぼしの可能性） */
  truncatedCells: number
  /** 回数・時間の上限で打ち切ったか */
  aborted: boolean
  abortReason: string | null
}

function splitBbox(b: Bbox): Bbox[] {
  const mx = (b[0] + b[2]) / 2
  const my = (b[1] + b[3]) / 2
  return [
    [b[0], b[1], mx, my], [mx, b[1], b[2], my],
    [b[0], my, mx, b[3]], [mx, my, b[2], b[3]],
  ]
}

/**
 * bbox を検索し、件数が上限に達した区画は四分割して再検索する。
 * 同じ施設が区画の境界で重複して返るので、名称+座標で除く。
 */
export async function collectByBbox(
  fetchBbox: (b: Bbox) => Promise<OpenpoiFacility[]>,
  bbox: Bbox,
  opts: CollectOptions = {},
): Promise<CollectResult> {
  const maxRequests = opts.maxRequests ?? 150
  const maxDepth = opts.maxDepth ?? 7
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const delayMs = opts.delayMs ?? 100
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const seen = new Map<string, OpenpoiFacility>()
  let queue: { b: Bbox; depth: number }[] = [{ b: bbox, depth: 0 }]
  let requests = 0
  let truncatedCells = 0
  let aborted = false
  let abortReason: string | null = null

  while (queue.length > 0) {
    if (requests >= maxRequests) { aborted = true; abortReason = `リクエスト回数の上限（${maxRequests}回）に達した`; break }
    if (opts.deadlineAt !== undefined && now() >= opts.deadlineAt) { aborted = true; abortReason = '時間の上限に達した'; break }
    if (requests > 0 && delayMs > 0) await sleep(delayMs)
    const wave = queue.slice(0, Math.min(concurrency, maxRequests - requests))
    queue = queue.slice(wave.length)
    const results = await Promise.all(wave.map((c) => fetchBbox(c.b)))
    requests += wave.length
    results.forEach((rows, i) => {
      for (const f of rows) {
        const lat = toNum(f.lat)
        const lng = toNum(f.lng)
        const key = `${baseNormalize(f.name ?? '')}|${lat?.toFixed(6)}|${lng?.toFixed(6)}|${f.source ?? ''}`
        if (!seen.has(key)) seen.set(key, f)
      }
      if (rows.length >= SEARCH_LIMIT) {
        if (wave[i].depth < maxDepth) for (const c of splitBbox(wave[i].b)) queue.push({ b: c, depth: wave[i].depth + 1 })
        else truncatedCells++
      }
    })
  }
  // 打ち切り時、まだ分割待ちだった区画は取りこぼしの可能性がある
  truncatedCells += queue.length
  return { facilities: [...seen.values()], requests, truncatedCells, aborted, abortReason }
}

// ---------------------------------------------------------------------------
// 投稿内容の組み立て（プレビュー・登録で共通）
// ---------------------------------------------------------------------------

export const TITLE_MAX = 40
export const BODY_MAX = 1000

export type CandidateForPost = {
  /** 'openpoi'（公開データ）／'manual'（運営が手で追加）。省略は openpoi 扱い */
  source?: string | null
  name: string
  prefecture: string | null
  city: string | null
  address: string | null
  openpoi_category: string | null
  category: string | null
  phone: string | null
  website: string | null
  opening_hours: string | null
  description: string | null
}

export type CandidateEdits = Partial<{
  title: string
  body: string
  category: string
  address: string
  phone: string
  website: string
  opening_hours: string
  description: string   // 紹介文（本文の先頭に入る）
}>

export type PostDraft = {
  title: string
  body: string
  category: string | null
  location: string | null
  address: string | null
  links: { label: string; url: string }[]
}

export function clip(s: string, max: number): string {
  const a = Array.from(s)
  return a.length <= max ? s : a.slice(0, max - 1).join('') + '…'
}

export const IMPORT_NOTICE_MANUAL =
  '※この掲載は、運営が登録した店舗情報です。掲載者本人による投稿ではありません。営業時間・定休日・内容は変わることがあるため、お出かけ前に店舗の公式情報でご確認ください。'

export const IMPORT_NOTICE =
  '※この掲載は、公開データ（OpenPOI API）をもとに運営が登録した施設情報です。掲載者本人による投稿ではありません。営業時間・定休日・内容は変わることがあるため、お出かけ前に店舗の公式情報でご確認ください。'

/**
 * 掲載に出す文字をそろえる。OpenPOI（食品営業許可・届出データ由来）は全角の英数字・ハイフンが多いので、
 * NFKC で半角にし、数字にはさまれた長音「ー」・各種ダッシュはハイフンにする。
 * 「ー」は店名で使うので、数字にはさまれたときだけ直す。
 */
export function normalizeDisplayText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/(?<=\d)ー(?=\d)/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 運営の編集(edits)を最優先に、OpenPOI由来の値から投稿内容を組み立てる */
export function buildPostDraft(c: CandidateForPost, edits: CandidateEdits = {}): PostDraft {
  // 運営が打った内容はそのまま、OpenPOI由来の値は表示用にそろえる
  const address = (edits.address ?? normalizeDisplayText(c.address ?? '')).trim() || null
  const phone = (edits.phone ?? c.phone ?? '').trim()
  const website = (edits.website ?? c.website ?? '').trim()
  const hours = (edits.opening_hours ?? c.opening_hours ?? '').trim()
  const description = (edits.description ?? c.description ?? '').trim()
  const category = (edits.category ?? c.category) || null
  const place = address ?? ([c.prefecture, c.city].filter(Boolean).join('') || null)

  const baseName = normalizeDisplayText(c.name)
  const title = clip((edits.title ?? baseName).trim() || baseName, TITLE_MAX)

  let body: string
  if (edits.body !== undefined && edits.body.trim()) {
    body = edits.body.trim()
  } else {
    const lines: string[] = []
    if (description) lines.push(description, '')
    const manual = c.source === 'manual'
    if (!manual) lines.push(`🏷 種別：${openpoiCategoryLabel(c.openpoi_category)}`)
    if (place) lines.push(`📍 所在地：${place}`)
    if (phone) lines.push(`☎ 電話：${phone}`)
    if (hours) lines.push(`🕐 営業時間：${hours}`)
    if (website) lines.push(`🔗 Web：${website}`)
    lines.push('', manual ? IMPORT_NOTICE_MANUAL : IMPORT_NOTICE)
    body = lines.join('\n')
  }
  body = clip(body, BODY_MAX)

  const links: { label: string; url: string }[] = []
  if (/^https?:\/\//i.test(website)) links.push({ label: '公式サイト', url: website })

  return { title, body, category, location: place ? clip(place, 80) : null, address, links }
}

export type Publishability = { ok: true } | { ok: false; reason: string }

/** 登録してよい状態か（既存データ保護のため、重複・未分類は明示的な操作を要求する） */
export function checkPublishable(
  c: { import_status: string; duplicate_status: string },
  draft: PostDraft,
  opts: { allowDuplicate?: boolean; confirmPossible?: boolean } = {},
): Publishability {
  if (c.import_status === 'imported') return { ok: false, reason: '登録済みです' }
  if (c.import_status === 'publishing') return { ok: false, reason: '登録処理中です' }
  if (c.import_status === 'excluded') return { ok: false, reason: '除外されています（復元してください）' }
  if (c.duplicate_status === 'duplicate' && !opts.allowDuplicate) return { ok: false, reason: '重複と判定されています' }
  if (c.duplicate_status === 'possible' && !opts.confirmPossible) return { ok: false, reason: '重複の可能性があります。確認してください' }
  if (!draft.category) return { ok: false, reason: 'カテゴリーが未分類です。選択してください' }
  if (!draft.title.trim()) return { ok: false, reason: 'タイトルが空です' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 紹介文の下書き（AI）— 事実だけを書く方針
// ---------------------------------------------------------------------------
// 方針（2026-10-03 運営決定）: 口コミ・評価は使わない。公開データ（OpenPOI）と、
// 運営が貼ったお店自身の公式情報に書いてある事実だけで書く。評価や推測の言葉は入れない。

/** 紹介文に入れない評価・推測・誇張の言葉。見つけたら画面で警告し、AIには使わせない */
export const RISKY_PHRASES = [
  '人気', '話題', '評判', '口コミ', 'おいしい', '美味しい', '絶品', '名店', '老舗', '隠れ家', '行列', '大好評',
  'こだわり', '自慢', '最高', '最上', '一番', 'No.1', 'ナンバーワン', 'おすすめ', 'オススメ', '必見', '間違いない',
  '安い', '格安', '最安', 'お得', 'リーズナブル', '雰囲気がよい', '居心地', '素敵', '素晴らしい', '本格的', '本場',
  '厳選', '新鮮', 'ふわふわ', 'とろける', 'ジューシー',
] as const

/** 文中の危うい言葉（重複なし）。大小・全半角の違いは吸収して調べる */
export function findRiskyPhrases(text: string): string[] {
  const t = text.normalize('NFKC').toLowerCase()
  const hit = new Set<string>()
  for (const w of RISKY_PHRASES) if (t.includes(w.normalize('NFKC').toLowerCase())) hit.add(w)
  return [...hit]
}

/** 住所から町名（市区町村の次〜番地の前）を取り出す。「千葉県印西市武西1205-49」→「武西」 */
export function areaFromAddress(address: string | null | undefined, city: string | null | undefined): string | null {
  const a = normalizeDisplayText(address ?? '')
  if (!a) return null
  const c = (city ?? '').trim()
  const rest = c && a.includes(c) ? a.slice(a.indexOf(c) + c.length) : a.replace(/^.{2,3}[都道府県]/, '')
  const m = rest.match(/^([^\d\s０-９]{1,12})/)
  return m ? m[1] : null
}

export type IntroFacts = {
  name: string
  kind: string            // 「飲食店」「カフェ」など openpoiCategoryLabel の値（不明なら「不明」）
  prefecture: string | null
  city: string | null
  area: string | null     // 町名
  address: string | null
}

export const INTRO_MAX = 500

/** AIに渡す指示。口コミ・評価・推測を禁じ、参考テキスト（任意）に書かれた事実だけを使わせる */
export function buildIntroPrompt(facts: IntroFacts, reference: string): { system: string; user: string } {
  const system = [
    'あなたは、地域の掲示板「FreeFree」（印西市）に載せるお店の紹介文を、運営の下書きとして書くアシスタントです。',
    '次の決まりを必ず守ってください。',
    '- 書いてよいのは「与えられた事実」と「参考テキストに書かれていること」だけです。それ以外は一切足さない（推測・創作・一般論を書かない）。',
    '- 口コミ・評判・評価の言葉は書かない。「人気」「おいしい」「こだわり」「おすすめ」「老舗」「雰囲気がよい」など、良し悪しを述べる言葉と、価格が安い・高いという言葉も使わない。',
    '- 営業時間・定休日・メニュー・価格・創業年・電話番号は、参考テキストに書かれているときだけ、その通りに書く。無いときは触れない。',
    '- 種別が「不明」のときは、何の店かを断定せず、場所と店名だけを書く。',
    '- 敬体（です・ます）で、2〜4文、全体で60〜180字にする。店名は繰り返さなくてよい。',
    '- 最後の文に、お店の方への呼びかけは入れない（別の欄に入る）。',
    '- 出力は紹介文の本文だけ。前置き・見出し・かっこ書きの説明・引用符は付けない。',
  ].join('\n')
  const lines = [
    '【与えられた事実】',
    `店名：${facts.name}`,
    `種別：${facts.kind}`,
    `所在地：${[facts.prefecture, facts.city].filter(Boolean).join('')}${facts.area ?? ''}${facts.address ? `（住所：${facts.address}）` : ''}`,
  ]
  const ref = reference.trim()
  lines.push('', ref ? `【参考テキスト（お店自身の公式な情報。ここに書かれた事実だけ使う）】\n${ref.slice(0, 4000)}` : '【参考テキスト】なし（事実は上の3つだけ。短く、場所と種別を伝える文にする）')
  lines.push('', '上の決まりに従って、紹介文を書いてください。')
  return { system, user: lines.join('\n') }
}

/** AIの返答を整える（前後の空白・引用符・見出し行・長さ）。空なら null */
export function sanitizeIntro(raw: string): string | null {
  let t = raw.trim().replace(/^["「『]+|["」』]+$/g, '').trim()
  t = t.replace(/^(紹介文|本文)[:：]\s*/, '')
  t = Array.from(t).slice(0, INTRO_MAX).join('').trim()
  return t || null
}

/** 画像カード・SNS用のエリア表記。「千葉県印西市武西1205-49」→「印西市武西」。作れなければ null */
export function areaLabelFromLocation(location: string | null | undefined): string | null {
  const a = normalizeDisplayText(location ?? '').replace(/^.{2,3}[都道府県]/, '')
  const m = a.match(/^([^\d\s-]{2,16})/)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// 地図・位置情報の出典表記（2026-10-03 規約確認）
// ---------------------------------------------------------------------------
// ・地理院タイル: 国土地理院コンテンツ利用規約。出典として「国土地理院」または「地理院タイル」を書き、
//   地理院タイル一覧ページへのリンクを付ける。加工したときは加工した旨も書く（申請は不要）
// ・国土地理院の住所検索（msearch.gsi.go.jp）: 国土地理院自身の規約は無い。中身は東京大学CSISの
//   シンプルジオコーディング実験で、地図等に使うときは
//   「CSISシンプルジオコーディング実験（街区レベル位置参照情報）による」の表記が求められる

export const GSI_TILE_URL = 'https://maps.gsi.go.jp/development/ichiran.html'

/** 画像カード（地図の隅）に入れる短い出典 */
export const GSI_CARD_CREDIT = '地図：地理院タイルを加工して作成（国土地理院）'

/** SNS の投稿文に添える出典の1行（画像にはリンクを付けられないので、投稿文に書く） */
export function gsiCreditLine(): string {
  return `地図：国土地理院 地理院タイルを加工して作成 ${GSI_TILE_URL}`
}

/** 住所から位置を求めたときの出典（CSIS の参加規約 第4条） */
export const GEOCODE_CREDIT = 'CSISシンプルジオコーディング実験（街区レベル位置参照情報）による'

/** お店向けの案内ページ（取込掲載の注意書き・SNS・チラシのリンク先） */
export const FOR_SHOPS_PATH = '/freefree/for-shops'

/** 手で追加する候補の source_id。同じ店名＋住所なら同じID（二重追加を防ぐ） */
export function makeManualSourceId(name: string, address: string | null): string {
  return `manual-${hash53(`${baseNormalize(name)}|${addressKey(address) || baseNormalize(address ?? '')}`)}`
}
