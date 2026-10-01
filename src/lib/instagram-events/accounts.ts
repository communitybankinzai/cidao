// モニタ対象アカウント（Instagram）の投稿を Graph API の business_discovery で読む。
// 対象 = organizations.sns_links.instagram（団体）＋ sns_monitor_accounts（企業・行政など）。
//
// 制約（Meta の仕様）:
//   - 読めるのはビジネス／クリエイターアカウントだけ。個人アカウントは「(#100) ... not found」等で失敗する
//   - トークンに instagram_basic・instagram_manage_insights・pages_read_engagement が要る。無いと (#10) で失敗する
//   - 1 アカウント 1 リクエスト。media は新しい順

import { toIgMedia, type IgMedia } from './hashtag'

export const INSTAGRAM_ACCOUNT_SOURCE = 'instagram-account'
const GRAPH_BASE = 'https://graph.facebook.com/v22.0'
const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,timestamp'

export type MonitorAccount = {
  id: string | null          // sns_monitor_accounts.id（団体の sns_links 由来で行が無いときは null）
  username: string
  label: string
  kind: '団体' | '企業' | '行政' | 'その他'
  orgId: string | null
}

export type AccountFetchResult =
  | { ok: true; account: MonitorAccount; profile: { id: string; name: string; mediaCount: number | null }; media: IgMedia[] }
  | { ok: false; account: MonitorAccount; error: string; permissionDenied: boolean }

/** Instagram の URL／@付き／素のユーザー名から username を取り出す。取れなければ null */
export function parseInstagramUsername(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i.exec(s)
  const raw = m ? m[1] : s.replace(/^@/, '')
  if (!/^[A-Za-z0-9._]{1,30}$/.test(raw)) return null
  if (['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct'].includes(raw.toLowerCase())) return null
  return raw
}

export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** 1 アカウントの直近の投稿（最大 limit 件・新しい順）を読む */
export async function fetchAccountMedia(
  fetchFn: typeof fetch,
  args: { igUserId: string; token: string; account: MonitorAccount; limit?: number; timeoutMs?: number },
): Promise<AccountFetchResult> {
  const { account } = args
  const limit = args.limit ?? 12
  const fields = `business_discovery.username(${account.username}){id,username,name,media_count,media.limit(${limit}){${MEDIA_FIELDS}}}`
  const params = new URLSearchParams({ fields, access_token: args.token })
  let payload: Record<string, unknown>
  let status = 0
  try {
    const res = await fetchFn(`${GRAPH_BASE}/${encodeURIComponent(args.igUserId)}?${params}`, {
      headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(args.timeoutMs ?? 20_000),
    })
    status = res.status
    payload = asObject(await res.json().catch(() => ({})))
  } catch (e) {
    return { ok: false, account, error: `取得失敗: ${e instanceof Error ? e.message : String(e)}`, permissionDenied: false }
  }
  const err = asObject(payload.error)
  if (status !== 200 || Object.keys(err).length > 0) {
    const code = Number(err.code)
    const message = String(err.message ?? JSON.stringify(payload).slice(0, 200))
    const permissionDenied = code === 10
    const friendly = permissionDenied
      ? '検索用トークンに instagram_manage_insights の権限が無い（/admin/sns で再登録）'
      : /not found|does not exist|invalid username|cannot be found/i.test(message)
        ? 'アカウントが見つからない、またはビジネス／クリエイターアカウントではない'
        : message
    return { ok: false, account, error: `(#${Number.isFinite(code) ? code : '?'}) ${friendly}`, permissionDenied }
  }
  const bd = asObject(payload.business_discovery)
  const mediaRaw = asObject(bd.media).data
  const media: IgMedia[] = []
  if (Array.isArray(mediaRaw)) {
    for (const raw of mediaRaw) {
      const m = toIgMedia(raw)
      if (m) media.push({ ...m, account })
    }
  }
  const mediaCount = Number(bd.media_count)
  return {
    ok: true, account,
    profile: { id: String(bd.id ?? ''), name: String(bd.name ?? ''), mediaCount: Number.isFinite(mediaCount) ? mediaCount : null },
    media,
  }
}

/** 投稿日時が since より新しいものだけ（timestamp は '2026-10-01T02:54:42+0000' 形式） */
export function mediaSince(media: IgMedia[], since: Date): IgMedia[] {
  return media.filter((m) => {
    const t = Date.parse(m.timestamp.replace(/(\d{2})(\d{2})$/, '$1:$2'))
    return Number.isFinite(t) ? t >= since.getTime() : true
  })
}
