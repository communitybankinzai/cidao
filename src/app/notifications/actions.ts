'use server'

import { createClient } from '@/lib/supabase/server'

export type NotificationRow = {
  id: string
  kind: string
  title: string
  body: string | null
  link_url: string | null
  read_at: string | null
  created_at: string
}

/** 自分宛の通知（最新30件）と未読数を返す。未ログイン時は loggedIn: false */
export async function getMyNotifications(): Promise<{
  loggedIn: boolean
  rows: NotificationRow[]
  unread: number
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { loggedIn: false, rows: [], unread: 0 }

  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link_url, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(30)

  const rows = (data ?? []) as NotificationRow[]
  const unread = rows.filter((r) => !r.read_at).length
  return { loggedIn: true, rows, unread }
}

/** 自分宛の未読通知をすべて既読化 */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .eq('recipient_id', user.id)
}

/** Webプッシュ購読を保存（同一端末は endpoint 主キーで上書き） */
export async function savePushSubscription(sub: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    member_id: user.id,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  })
  if (error) throw new Error(`購読の保存に失敗: ${error.message}`)
}

/** Webプッシュ購読を解除 */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('member_id', user.id)
}
