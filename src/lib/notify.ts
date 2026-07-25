import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { sendWebPush } from '@/lib/push'

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
  kind: 'comment' | 'vote' | 'proposal' | 'system'
  title: string
  body?: string
  linkUrl?: string
}): Promise<void> {
  try {
    if (input.actorId && input.actorId === input.recipientId) return

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!supaUrl || !serviceKey) return

    const admin = createSupabaseClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
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
