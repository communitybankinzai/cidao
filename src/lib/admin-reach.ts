// 管理画面「届いているか」カードの集計。
// 通知を出しても、アプリの外で受け取れていない・開いていない会員にはそもそも届かない。
// 運営が週に一度これを見て、通知の経路（プッシュ購読・既読・ログイン）の広がりを測れるようにする。
// 名前は扱わない（人数だけ）。

import type { SupabaseClient } from '@supabase/supabase-js'

export type ReachMember = { id: string; tier: string | null; contact_preferences: unknown }

export type ReachSummary = {
  /** 在籍している会員（退会していない人） */
  total: number
  /** Webプッシュを1端末でも購読している人 */
  push: number
  /** 直近14日にログインした人 */
  loggedIn14d: number
  /** 通知が届いているのに、一度も既読にしていない人 */
  neverRead: number
  /** 仮登録（light）のまま止まっている人 */
  light: number
  /** 設定で「イベント通知を受け取る」を外している人 */
  offEvent: number
  /** 設定で「FreeFree通知を受け取る」を外している人 */
  offFreeFree: number
}

/** 2026-11-06 の実測。施策の前後を比べるための基準値（在籍44名） */
export const REACH_BASELINE: { date: string } & ReachSummary = {
  date: '2026-11-06',
  total: 44,
  push: 5,
  loggedIn14d: 17,
  neverRead: 19,
  light: 11,
  offEvent: 7,
  offFreeFree: 9,
}

const DAY_MS = 24 * 3600_000

export function summarizeReach(input: {
  members: ReachMember[]
  pushMemberIds: Iterable<string>
  /** 通知が1件でも届いている人 */
  notifiedIds: Iterable<string>
  /** 通知を1件でも既読にした人 */
  readIds: Iterable<string>
  /** 会員ID → 最終ログイン（ISO）。無ければ null / 欠落 */
  lastSignIns: ReadonlyMap<string, string | null>
  now: Date
}): ReachSummary {
  const active = new Set(input.members.map((m) => m.id))
  const push = new Set([...input.pushMemberIds].filter((id) => active.has(id)))
  const notified = new Set([...input.notifiedIds].filter((id) => active.has(id)))
  const read = new Set([...input.readIds].filter((id) => active.has(id)))
  const since = input.now.getTime() - 14 * DAY_MS

  let loggedIn14d = 0
  let neverRead = 0
  let light = 0
  let offEvent = 0
  let offFreeFree = 0
  for (const m of input.members) {
    const last = input.lastSignIns.get(m.id)
    if (last && new Date(last).getTime() >= since) loggedIn14d += 1
    if (notified.has(m.id) && !read.has(m.id)) neverRead += 1
    if (m.tier === 'light') light += 1
    const prefs = (m.contact_preferences ?? {}) as Record<string, unknown>
    if (prefs.notify_event === false) offEvent += 1
    if (prefs.notify_freefree === false) offFreeFree += 1
  }
  return {
    total: input.members.length,
    push: push.size,
    loggedIn14d,
    neverRead,
    light,
    offEvent,
    offFreeFree,
  }
}

const PAGE = 1000
const MAX_PAGES = 30 // 通知の行は会員数 × 配信数。上限を置いて、増えても管理画面が重くならないようにする

/** 通知の「届いた人」「既読にした人」を、行を読みながら集める */
async function loadNotificationReach(admin: SupabaseClient): Promise<{ notified: Set<string>; read: Set<string> }> {
  const notified = new Set<string>()
  const read = new Set<string>()
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from('notifications')
      .select('recipient_id, read_at')
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error('notifications query failed')
    const rows = (data ?? []) as { recipient_id: string; read_at: string | null }[]
    for (const r of rows) {
      notified.add(r.recipient_id)
      if (r.read_at) read.add(r.recipient_id)
    }
    if (rows.length < PAGE) break
  }
  return { notified, read }
}

/** service_role のクライアントを渡す。失敗したら例外（呼び出し側で握りつぶして、カードだけ出さない） */
export async function loadReachSummary(admin: SupabaseClient, now = new Date()): Promise<ReachSummary> {
  const [membersRes, pushRes, usersRes, notif] = await Promise.all([
    admin.from('members').select('id, tier, contact_preferences').is('deleted_at', null),
    admin.from('push_subscriptions').select('member_id'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    loadNotificationReach(admin),
  ])
  if (membersRes.error || pushRes.error || usersRes.error) throw new Error('reach query failed')

  const lastSignIns = new Map<string, string | null>()
  for (const u of usersRes.data.users) lastSignIns.set(u.id, u.last_sign_in_at ?? null)

  return summarizeReach({
    members: (membersRes.data ?? []) as ReachMember[],
    pushMemberIds: ((pushRes.data ?? []) as { member_id: string }[]).map((r) => r.member_id),
    notifiedIds: notif.notified,
    readIds: notif.read,
    lastSignIns,
    now,
  })
}
