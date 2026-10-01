// Instagram のハッシュタグ検索（Graph API）で #印西 の直近24時間の公開投稿を取り、
// 「催しの告知らしい投稿」だけを AI 読み取りの候補に絞る（ここまでは AI を使わない）。
//
// 制約（Meta の仕様・2026-10-01 確認）:
//   - recent_media は「直近24時間に公開された投稿」だけ。毎朝1回の巡回で漏れなく拾える
//   - 1ユーザーあたり7日間で30種類のハッシュタグまで（防災MAPの4語と合わせても余裕あり）
//   - ハッシュタグ経由の media では username は取れない（本文・画像・投稿リンクは取れる）
//   - 人気タグは limit が大きい／children を付けると 20 秒以上かけて「Please reduce the amount of data」で落ちる
//     （2026-10-01 実測：children あり 25 件＝27 秒で 500、children なし 10 件＝9 秒で成功）。10 件ずつ・children なし

export const INSTAGRAM_HASHTAG_SOURCE = 'instagram-hashtag'
/** 巡回するハッシュタグ（# は付けない）。運営決定 2026-10-01：#印西 のみ */
export const INSTAGRAM_EVENT_HASHTAG = '印西'

const GRAPH_BASE = 'https://graph.facebook.com/v22.0'
// children は要求しない（カルーセルの media_url は先頭の画像を指す）
const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,timestamp'
const PAGE_TIMEOUT_MS = 30_000

export type IgMediaChild = { id: string; media_type: string; media_url: string }

export type IgMedia = {
  id: string
  caption: string
  media_type: string
  media_url: string
  permalink: string
  timestamp: string
  children: IgMediaChild[]
  /** アカウント経由で集めた投稿だけ持つ（出典の表記と external_source の判定に使う） */
  account?: { id: string | null; username: string; label: string; kind: '団体' | '企業' | '行政' | 'その他'; orgId: string | null }
}

type FetchFn = typeof fetch

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function httpsUrl(v: unknown): string {
  const s = str(v)
  return /^https:\/\//.test(s) ? s : ''
}

export function toIgMedia(raw: unknown): IgMedia | null {
  const o = asObject(raw)
  const id = str(o.id)
  const permalink = httpsUrl(o.permalink)
  if (!id || !permalink) return null
  const childrenRaw = asObject(o.children).data
  const children: IgMediaChild[] = Array.isArray(childrenRaw)
    ? childrenRaw
        .map((c) => {
          const co = asObject(c)
          return { id: str(co.id), media_type: str(co.media_type), media_url: httpsUrl(co.media_url) }
        })
        .filter((c) => c.id)
    : []
  return {
    id,
    caption: str(o.caption),
    media_type: str(o.media_type),
    media_url: httpsUrl(o.media_url),
    permalink,
    timestamp: str(o.timestamp),
    children,
  }
}

async function graphJson(fetchFn: FetchFn, url: string): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) })
  const payload = asObject(await res.json().catch(() => ({})))
  return { ok: res.ok, status: res.status, payload }
}

function errorText(payload: Record<string, unknown>): string {
  return JSON.stringify(payload.error ?? payload).slice(0, 240)
}

/** ハッシュタグの ID を引く。投稿が1件もないタグは「存在しない」扱いで null */
export async function lookupHashtagId(fetchFn: FetchFn, userId: string, token: string, hashtag: string): Promise<string | null> {
  const params = new URLSearchParams({ user_id: userId, q: hashtag.replace(/^#/, ''), access_token: token })
  const { ok, status, payload } = await graphJson(fetchFn, `${GRAPH_BASE}/ig_hashtag_search?${params}`)
  const data = Array.isArray(payload.data) ? payload.data : []
  const id = str(asObject(data[0]).id)
  if (ok && id) return id
  const detail = errorText(payload)
  if (/does not exist/i.test(detail)) return null
  throw new Error(`Instagram hashtag ${status}: ${detail}`)
}

/**
 * 直近24時間の投稿をページ送りで取る（最大 maxPages ページ。deadline（epoch ms）を過ぎたらそこで打ち切る）。
 * 1 ページ目が「reduce the amount of data」なら 5 件に絞って 1 回だけ再試行。
 */
export async function fetchHashtagRecentMedia(
  fetchFn: FetchFn,
  args: { userId: string; token: string; hashtag: string; maxPages?: number; pageSize?: number; deadline?: number },
): Promise<{ media: IgMedia[]; pages: number; hashtagId: string | null; truncated: boolean }> {
  const maxPages = args.maxPages ?? 10
  const pageSize = args.pageSize ?? 10
  const deadline = args.deadline ?? Number.POSITIVE_INFINITY
  const hashtagId = await lookupHashtagId(fetchFn, args.userId, args.token, args.hashtag)
  if (!hashtagId) return { media: [], pages: 0, hashtagId: null, truncated: false }

  const firstUrl = (fields: string, limit: number) => {
    const params = new URLSearchParams({ user_id: args.userId, fields, limit: String(limit), access_token: args.token })
    return `${GRAPH_BASE}/${encodeURIComponent(hashtagId)}/recent_media?${params}`
  }

  let url: string | null = firstUrl(MEDIA_FIELDS, pageSize)
  const media: IgMedia[] = []
  const seen = new Set<string>()
  let pages = 0
  let truncated = false
  while (url && pages < maxPages) {
    if (pages > 0 && Date.now() > deadline) {
      truncated = true
      break
    }
    let { ok, status, payload } = await graphJson(fetchFn, url)
    if (!ok && pages === 0 && /reduce the amount of data/i.test(str(asObject(payload.error).message))) {
      url = firstUrl(MEDIA_FIELDS, Math.max(1, Math.min(5, pageSize - 1)))
      ;({ ok, status, payload } = await graphJson(fetchFn, url))
    }
    if (!ok) throw new Error(`Instagram media ${status}: ${errorText(payload)}`)
    pages++
    const data = Array.isArray(payload.data) ? payload.data : []
    for (const raw of data) {
      const m = toIgMedia(raw)
      if (m && !seen.has(m.id)) {
        seen.add(m.id)
        media.push(m)
      }
    }
    // 24 時間分を取り終えると、next カーソルが付いたまま空のページが 20 ページ以上続く（2026-10-01 実測）。空なら終わり
    if (data.length === 0) {
      url = null
      break
    }
    const next = str(asObject(payload.paging).next)
    url = next && /^https:\/\/graph\.facebook\.com\//.test(next) ? next : null
  }
  if (url && pages >= maxPages) truncated = true
  return { media, pages, hashtagId, truncated }
}

// ---------------------------------------------------------------------------
// 一次ふるい（AI 不使用）。読み取り費用を抑えるため、本文に「日付」と「催しの語」があり、
// 画像を持つ投稿だけを候補にする。
// ---------------------------------------------------------------------------

const EVENT_WORDS_RE =
  /開催|イベント|マルシェ|講座|参加|申込|申し込み|会場|ワークショップ|体験|教室|フェス|祭|まつり|コンサート|ライブ|上映|展示|展覧|募集|受付|セミナー|説明会|相談会|大会|交流会|おはなし会|お話し会|出店|出展|公演|発表会|マーケット|バザー|縁日|ツアー|観察会|ハイキング|寄席|演奏会|学習会|講演|見学会|清掃|ボランティア/
const NOT_EVENT_RE = /求人|スタッフ募集|アルバイト|パート募集|正社員|賃貸|物件|売買|新築|中古車|入荷しました|営業時間のお知らせ/

export function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

/** 本文に「10/12」「10月12日」「12日（土）」のような日付表記があるか */
export function hasDateMention(caption: string): boolean {
  const t = normalizeDigits(caption)
  if (/(?:^|[^\d])(\d{1,2})\s*[/／]\s*(\d{1,2})(?!\d)/.test(t)) return true
  if (/(\d{1,2})\s*月\s*(\d{1,2})\s*日/.test(t)) return true
  if (/(?:^|[^\d月])(\d{1,2})\s*日\s*[（(]?[月火水木金土日祝]/.test(t)) return true
  return false
}

export type Prefilter = { ok: true } | { ok: false; reason: 'no_image' | 'no_date' | 'no_event_word' | 'not_event' }

export function looksLikeEventPost(media: IgMedia): Prefilter {
  if (!pickImageUrl(media)) return { ok: false, reason: 'no_image' }
  const caption = media.caption ?? ''
  if (NOT_EVENT_RE.test(caption)) return { ok: false, reason: 'not_event' }
  if (!hasDateMention(caption)) return { ok: false, reason: 'no_date' }
  if (!EVENT_WORDS_RE.test(caption)) return { ok: false, reason: 'no_event_word' }
  return { ok: true }
}

/** 読み取る画像の URL。単一画像はそのまま、カルーセルは最初の画像。動画（リール）は対象外 */
export function pickImageUrl(media: IgMedia): string | null {
  if (media.media_type === 'IMAGE') return media.media_url || null
  if (media.media_type === 'CAROUSEL_ALBUM') {
    const child = media.children.find((c) => c.media_type === 'IMAGE' && c.media_url)
    if (child) return child.media_url
    // children が取れなかったときは album 自身の media_url（先頭の画像）を使う
    return media.media_url || null
  }
  return null
}

/** 投稿本文の冒頭を AI の参考情報として渡す（長文はここで切る） */
export function captionHint(caption: string, max = 600): string {
  const t = caption.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
