// 食レポ飲食店マップ（CBIサイト site/gourmet-map）の入力の検査。
// 市民が SNS の食レポの URL を飲食店のピンに付ける。写真は「自分の投稿」のときだけ1枚。
// 2026-11-06 事業主決定：お店＝OpenStreetMap＋市民の登録（＋FreeFreeの飲食の掲載）／すぐ公開・運営が伏せる／匿名で貼れる
// ／他人の投稿も貼れる（写真は出さずリンクだけ）。

// 印西市と周辺（白井・栄町・佐倉北部・成田西部・我孫子南部・柏東部）。site/gourmet-map/pipeline/build_shops.py の BBOX と揃える
export const GOURMET_BBOX = { south: 35.70, west: 140.02, north: 35.90, east: 140.32 }

export const MAX_COMMENT = 100
export const MAX_SHOP_NAME = 60
export const MAX_ADDRESS = 100
export const MAX_HANDLE = 40

// 貼れる URL の行き先。SNS とブログだけにする（広告サイト・短縮URLで行き先を隠すものは受けない）
const PLATFORMS: Array<{ id: string; label: string; hosts: RegExp }> = [
  { id: 'instagram', label: 'Instagram', hosts: /(^|\.)instagram\.com$/ },
  { id: 'threads', label: 'Threads', hosts: /(^|\.)threads\.(net|com)$/ },
  { id: 'x', label: 'X', hosts: /(^|\.)(x|twitter)\.com$/ },
  { id: 'tiktok', label: 'TikTok', hosts: /(^|\.)tiktok\.com$/ },
  { id: 'youtube', label: 'YouTube', hosts: /(^|\.)(youtube\.com|youtu\.be)$/ },
  { id: 'facebook', label: 'Facebook', hosts: /(^|\.)(facebook\.com|fb\.watch)$/ },
  { id: 'bluesky', label: 'Bluesky', hosts: /(^|\.)bsky\.app$/ },
  { id: 'lemon8', label: 'Lemon8', hosts: /(^|\.)lemon8-app\.com$/ },
  { id: 'note', label: 'note', hosts: /(^|\.)note\.com$/ },
  { id: 'ameblo', label: 'アメブロ', hosts: /(^|\.)ameblo\.jp$/ },
  { id: 'hatena', label: 'はてなブログ', hosts: /(^|\.)(hatenablog\.(com|jp)|hateblo\.jp|hatenadiary\.(com|jp))$/ },
]

export type GourmetUrl = { url: string; platform: string; platformLabel: string; handle: string | null }

/** SNS の投稿 URL を確かめて、媒体と（URL から分かれば）投稿者名を返す。受けない URL は null */
export function parseSnsUrl(raw: unknown): GourmetUrl | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text.length > 500 || /[\u0000-\u001f\u007f\s]/.test(text)) return null
  let url: URL
  try { url = new URL(text) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
  const platform = PLATFORMS.find((p) => p.hosts.test(host))
  if (!platform) return null
  const segs = url.pathname.split('/').filter(Boolean)
  if (segs.length === 0) return null // トップページやプロフィールだけの URL は投稿ではない
  // 追跡用のパラメータは落とす（igsh・utm など）。YouTube の v だけは残す
  const kept = new URLSearchParams()
  if (platform.id === 'youtube' && url.searchParams.get('v')) kept.set('v', url.searchParams.get('v') as string)
  url.search = kept.toString()
  url.hash = ''
  return { url: url.href, platform: platform.id, platformLabel: platform.label, handle: handleFromUrl(platform.id, host, segs) }
}

function cleanHandle(value: string | undefined): string | null {
  if (!value) return null
  const v = decodeURIComponent(value).replace(/^@/, '')
  return /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : null
}

function handleFromUrl(platform: string, host: string, segs: string[]): string | null {
  switch (platform) {
    case 'x': return segs[1] === 'status' ? cleanHandle(segs[0]) : null
    case 'threads':
    case 'tiktok': return segs[0]?.startsWith('@') ? cleanHandle(segs[0]) : null
    case 'bluesky': return segs[0] === 'profile' && segs[2] === 'post' ? cleanHandle(segs[1]) : null
    case 'note':
    case 'ameblo': return cleanHandle(segs[0])
    case 'hatena': return cleanHandle(host.split('.')[0])
    case 'instagram': return segs.length >= 3 && (segs[1] === 'p' || segs[1] === 'reel') ? cleanHandle(segs[0]) : null
    default: return null
  }
}

/** 投稿者名（任意）。@ は外して英数字と . _ - だけ */
export function normalizeHandle(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') return undefined
  const v = raw.trim().replace(/^@/, '')
  if (!v) return null
  return /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : undefined
}

/** ひとこと・店名・住所などの短い文。制御文字は受けない。長すぎれば undefined */
export function normalizeText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return undefined
  const v = raw.replace(/\s+/g, ' ').trim()
  if (!v) return null
  if ([...v].length > max || /[\u0000-\u001f\u007f]/.test(v)) return undefined
  return v
}

export function insideGourmetArea(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= GOURMET_BBOX.south && lat <= GOURMET_BBOX.north && lon >= GOURMET_BBOX.west && lon <= GOURMET_BBOX.east
}

export function roundCoord(v: number) {
  return Math.round(v * 1e6) / 1e6
}

// お店の参照：osm:n123 / osm:w123 / osm:r123（OpenStreetMap）・poi:<12桁の16進>（OpenPOI API 由来・osm と同じ一覧ファイル）
// ・shop:<uuid>（市民の登録）・ff:<uuid>（FreeFreeの掲載）
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export type ShopRef = { kind: 'osm' | 'poi' | 'shop' | 'ff'; ref: string; id: string }
export function parseShopRef(raw: unknown): ShopRef | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  let m = /^osm:([nwr]\d{1,12})$/.exec(v)
  if (m) return { kind: 'osm', ref: v, id: m[1] }
  m = /^poi:([0-9a-f]{12})$/.exec(v)
  if (m) return { kind: 'poi', ref: v, id: m[1] }
  m = new RegExp(`^(shop|ff):(${UUID})$`).exec(v)
  if (m) return { kind: m[1] as 'shop' | 'ff', ref: v, id: m[2] }
  return null
}
