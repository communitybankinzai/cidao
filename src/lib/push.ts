import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type Subscription = { endpoint: string; p256dh: string; auth: string }

const SELECT_CHUNK = 500 // in() に一度に渡す member_id の数
const SEND_CONCURRENCY = 20 // 同時に投げるプッシュ送信数（Vercel の同時接続を圧迫しないため）

function resolveEnv() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:communitybankinzai@gmail.com'
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!publicKey || !privateKey || !supaUrl || !serviceKey) return null

  const admin = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { admin, subject, publicKey, privateKey }
}

type PushEnv = NonNullable<ReturnType<typeof resolveEnv>>

/**
 * 購読リストへ実際に送る。失効した購読（404/410）は削除する。
 * SEND_CONCURRENCY 件ずつに区切って送る。
 */
async function deliver(env: PushEnv, subs: Subscription[], payload: string): Promise<number> {
  if (subs.length === 0) return 0

  const webpush = (await import('web-push')).default
  webpush.setVapidDetails(env.subject, env.publicKey, env.privateKey)

  let sent = 0
  for (let i = 0; i < subs.length; i += SEND_CONCURRENCY) {
    const batch = subs.slice(i, i + SEND_CONCURRENCY)
    await Promise.all(
      batch.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          )
          sent += 1
        } catch (e: unknown) {
          const statusCode = (e as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            // 失効した購読は掃除する
            await env.admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          }
        }
      }),
    )
  }
  return sent
}

function buildPayload(input: { title: string; body?: string; url?: string }): string {
  return JSON.stringify({
    title: input.title,
    body: input.body ?? '',
    url: input.url ?? '/',
  })
}

/**
 * Webプッシュ送信ヘルパー（1人向け）。
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
    const env = resolveEnv()
    if (!env) return

    const { data: subs } = await env.admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('member_id', input.recipientId)
    if (!subs || subs.length === 0) return

    await deliver(env, subs as Subscription[], buildPayload(input))
  } catch {
    // best-effort。プッシュ失敗は本体処理に影響させない
  }
}

/**
 * Webプッシュ送信ヘルパー（多数向け）。全体配信 notifyAllMembers から使う。
 *
 * - recipientIds を SELECT_CHUNK 件ずつに割って購読を集め、まとめて送る
 * - 購読していないメンバーは自然に対象外（push_subscriptions に行が無い）
 * - 戻り値は実際に送信できた端末数（ログ・管理画面表示用）
 */
export async function sendWebPushToMany(input: {
  recipientIds: string[]
  title: string
  body?: string
  url?: string
}): Promise<number> {
  try {
    if (input.recipientIds.length === 0) return 0
    const env = resolveEnv()
    if (!env) return 0

    const subs: Subscription[] = []
    for (let i = 0; i < input.recipientIds.length; i += SELECT_CHUNK) {
      const ids = input.recipientIds.slice(i, i + SELECT_CHUNK)
      const { data } = await env.admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('member_id', ids)
      if (data) subs.push(...(data as Subscription[]))
    }
    if (subs.length === 0) return 0

    return await deliver(env, subs, buildPayload(input))
  } catch {
    // best-effort。プッシュ失敗は本体処理に影響させない
    return 0
  }
}
