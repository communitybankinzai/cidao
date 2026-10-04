// FreeFree 掲載の動画（1本）の決まりごと。画面（アップロード前の検査）とサーバー（保存前の検査）で同じ判定を使う。
// 動画は images 列には入れず freefree_posts.video_url に1本だけ持つ（SNS の画像カードが images を画像として読むため）。
//
// video_url に入れてよいのは次の2種類だけ:
//   1. 自分たちの freefree-videos バケットにアップロードした動画（MP4/WebM・20MBまで）
//   2. YouTube のリンク（youtube.com/watch・youtu.be・shorts）。掲載ページに埋め込んで再生する

export const FREEFREE_VIDEO_BUCKET = 'freefree-videos'
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024 // 無料枠の容量・転送量を守るため（2026-10-05 事業主決定）
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const
export const VIDEO_ACCEPT = VIDEO_MIME_TYPES.join(',')

const PUBLIC_PATH = `/storage/v1/object/public/${FREEFREE_VIDEO_BUCKET}/`

// アップロード前の検査。問題があれば画面に出す文言を返し、問題なければ null
export function checkVideoFile(file: { size: number; type: string }): string | null {
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return '動画は MP4 または WebM を選んでください'
  }
  if (file.size <= 0) return '動画ファイルが空です'
  if (file.size > MAX_VIDEO_BYTES) {
    return `動画が大きすぎます（${Math.floor(MAX_VIDEO_BYTES / 1024 / 1024)}MB まで）`
  }
  return null
}

// YouTube のリンクから動画IDを取り出す。YouTube のリンクでなければ null
export function youtubeIdOf(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] ?? null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') id = u.searchParams.get('v')
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') id = parts[1] ?? null
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

// 掲載ページに埋め込むときの URL（広告・履歴を抑える youtube-nocookie）
export function youtubeEmbedUrl(input: unknown): string | null {
  const id = youtubeIdOf(input)
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}

// 保存してよい動画 URL か。自分の freefree-videos バケットの公開 URL か、YouTube のリンクだけ通す
// （他のサイトの URL や、画像バケットの URL を video_url に入れさせない）。
// 通れば保存する値（YouTube は正規の watch URL にそろえる）、通らなければ null
export function normalizeVideoUrl(input: unknown, supabaseUrl: string | undefined): string | null {
  if (typeof input !== 'string') return null
  const url = input.trim()
  if (!url) return null

  const yt = youtubeIdOf(url)
  if (yt) return `https://www.youtube.com/watch?v=${yt}`

  const base = (supabaseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base.startsWith('https://')) return null
  const prefix = `${base}${PUBLIC_PATH}`
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  if (!rest || /[?#\s]/.test(rest) || rest.includes('..')) return null
  return url
}

// URL から Storage 上のパスを取り出す（削除用）。バケットの URL でなければ（YouTube を含む）null
export function videoStoragePath(url: string): string | null {
  const i = url.indexOf(PUBLIC_PATH)
  if (i < 0) return null
  const path = url.slice(i + PUBLIC_PATH.length)
  return path || null
}
