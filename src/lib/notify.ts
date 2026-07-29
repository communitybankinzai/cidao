import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { sendWebPush, sendWebPushToMany } from '@/lib/push'

export type NotificationKind =
  | 'comment'
  | 'vote'
  | 'proposal'
  | 'system'
  | 'freefree'
  | 'event'
  | 'member'
  | 'org'

const INSERT_CHUNK = 500 // 一度に INSERT する notifications 行数

function adminClient() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) return null
  return createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * アプリ内通知（notifications テーブル）への挿入ヘルパー。
 *
 * - INSERT は RLS で一般ユーザーに開放していないため service_role で行う
 * - best-effort：通知の失敗は呼び出し元のアクション（コメント投稿等）を失敗させない
 * - recipient と actor が同一人物の場合はスキップ（自分のアクションは通知しない）
 */
export async function insertNotification(input: {
  recipientId: string
  actorId?: string | null
  kind: NotificationKind
  title: string
  body?: string
  linkUrl?: string
}): Promise<void> {
  try {
    if (input.actorId && input.actorId === input.recipientId) return

    const admin = adminClient()
    if (!admin) return

    await admin.from('notifications').insert({
      recipient_id: input.recipientId,
      actor_id: input.actorId ?? null,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body ?? null,
      link_url: input.linkUrl ?? null,
    })

    // Webプッシュ（購読者のみ・best-effort）。スリープ中の端末にも届く
    await sendWebPush({
      recipientId: input.recipientId,
      title: input.title,
      body: input.body,
      url: input.linkUrl,
    })
  } catch {
    // best-effort：通知失敗は本体処理に影響させない
  }
}

/**
 * 全メンバーへの一斉通知（ベル🔔＋Webプッシュ）。
 *
 * 用途は2つ:
 *   1. 全体に知らせるべきアクションの自動通知
 *      （新着イベント / FreeFree掲載 / 新規提案 / メンバー本登録 / 団体の公開・更新）
 *   2. 管理者からの一斉お知らせ（/admin/notice、kind='system'）
 *
 * 仕様
 * - 宛先は未退会メンバー全員（tier 不問）。actorId 本人だけは除外する
 * - notifications を INSERT_CHUNK 件ずつ一括 INSERT し、そのあと購読端末へまとめてプッシュ
 * - push: false ならベルのみ（更新系など、端末に鳴らすほどではない通知に使う）
 * - dedupeMinutes を指定すると、同じ kind・同じ linkUrl の全体通知が直近N分以内に
 *   出ていた場合はスキップする（団体情報の連続編集などで何通も飛ばさないため）
 * - broadcast_id を全行に付与し、1回の送信を1グループとして後から追えるようにする
 * - best-effort：失敗しても呼び出し元のアクション（投稿・登録など）は成立させる
 */
export async function notifyAllMembers(input: {
  kind: NotificationKind
  title: string
  body?: string
  linkUrl?: string
  actorId?: string | null
  push?: boolean
  dedupeMinutes?: number
}): Promise<{ recipients: number; pushed: number; broadcastId: string | null }> {
  const empty = { recipients: 0, pushed: 0, broadcastId: null }
  try {
    const admin = adminClient()
    if (!admin) return empty

    if (input.dedupeMinutes && input.linkUrl) {
      const since = new Date(Date.now() - input.dedupeMinutes * 60_000).toISOString()
      const { data: recent } = await admin
        .from('notifications')
        .select('id')
        .eq('kind', input.kind)
        .eq('link_url', input.linkUrl)
        .not('broadcast_id', 'is', null)
        .gte('created_at', since)
        .limit(1)
      if (recent && recent.length > 0) return empty
    }

    const { data: members, error } = await admin
      .from('members')
      .select('id')
      .is('deleted_at', null)
    if (error || !members) return empty

    const recipientIds = (members as { id: string }[])
      .map((m) => m.id)
      .filter((id) => id !== input.actorId)
    if (recipientIds.length === 0) return empty

    const broadcastId = crypto.randomUUID()
    const title = input.title.slice(0, 200)

    for (let i = 0; i < recipientIds.length; i += INSERT_CHUNK) {
      const chunk = recipientIds.slice(i, i + INSERT_CHUNK)
      const { error: insertErr } = await admin.from('notifications').insert(
        chunk.map((recipientId) => ({
          recipient_id: recipientId,
          actor_id: input.actorId ?? null,
          kind: input.kind,
          title,
          body: input.body ?? null,
          link_url: input.linkUrl ?? null,
          broadcast_id: broadcastId,
        })),
      )
      if (insertErr) return { recipients: 0, pushed: 0, broadcastId: null }
    }

    let pushed = 0
    if (input.push !== false) {
      pushed = await sendWebPushToMany({
        recipientIds,
        title,
        body: input.body,
        url: input.linkUrl,
      })
    }

    return { recipients: recipientIds.length, pushed, broadcastId }
  } catch {
    return empty
  }
}
