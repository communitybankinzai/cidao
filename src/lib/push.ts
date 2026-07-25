import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Webプッシュ送信ヘルパー。
 *
 * - recipient の push_subscriptions 全端末に送信（best-effort）
 * - 失効した購読（404/410）は削除する
 * - VAPID鍵未設定時は何もしない
 */
export async function sendWebPush(input: {
  recipientId: string
  title: string
  body?: string
  url?: string
}): Promise<void> {
  try {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
    const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:communitybankinzai@gmail.com'
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!publicKey || !privateKey || !supaUrl || !serviceKey) return

    const admin = createSupabaseClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('member_id', input.recipientId)
    if (!subs || subs.length === 0) return

    const webpush = (await import('web-push')).default
    webpush.setVapidDetails(subject, publicKey, privateKey)

    const payload = JSON.stringify({
      title: input.title,
      body: input.body ?? '',
      url: input.url ?? '/',
    })

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          )
        } catch (e: unknown) {
          const statusCode = (e as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            // 失効した購読は掃除する
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          }
        }
      })
    )
  } catch {
    // best-effort。プッシュ失敗は本体処理に影響させない
  }
}
