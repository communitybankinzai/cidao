// Threads OAuth のコールバック（管理者専用）。
// 認可コード → 短期トークン → 長期トークン（60日）と交換し、
// keyword_search の可否を検証したうえで sns_threads_auth を上書き保存する。
// 保存形式は actions.ts の saveThreadsAuth と同一（週次リフレッシュcronの対象になる）。

import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function redirectWith(origin: string, result: string) {
  return NextResponse.redirect(`${origin}/admin/sns?threads_oauth=${result}`)
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const origin = url.origin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: isAdmin } = user ? await supabase.rpc('is_admin') : { data: false }
  if (!user || !isAdmin) {
    return NextResponse.redirect(`${origin}/login?next=/admin/sns`)
  }

  // ユーザーが認可画面でキャンセルした場合
  if (url.searchParams.get('error')) {
    return redirectWith(origin, 'denied')
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const stateCookie = request.cookies.get('threads_oauth_state')?.value
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return redirectWith(origin, 'state_mismatch')
  }

  const { data: appRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sns_threads_app')
    .maybeSingle()
  const app = appRow?.value as { app_id?: string; app_secret?: string } | null
  if (!app?.app_id || !app?.app_secret) {
    return redirectWith(origin, 'app_missing')
  }

  try {
    // ① 認可コード → 短期トークン
    const tokenResponse = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.app_id,
        client_secret: app.app_secret,
        grant_type: 'authorization_code',
        redirect_uri: `${origin}/api/admin/sns/threads-oauth/callback`,
        code,
      }),
    })
    const tokenJson = await tokenResponse.json().catch(() => ({}))
    if (!tokenResponse.ok || !tokenJson.access_token) {
      console.error('threads-oauth: code exchange failed', tokenJson?.error_message ?? tokenJson)
      return redirectWith(origin, 'exchange_failed')
    }

    // ② 短期 → 長期トークン（60日）
    const longParams = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: app.app_secret,
      access_token: String(tokenJson.access_token),
    })
    const longResponse = await fetch(`https://graph.threads.net/access_token?${longParams}`)
    const longJson = await longResponse.json().catch(() => ({}))
    if (!longResponse.ok || !longJson.access_token) {
      console.error('threads-oauth: long-lived exchange failed', longJson?.error ?? longJson)
      return redirectWith(origin, 'exchange_failed')
    }
    const longToken = String(longJson.access_token)
    const expiresInSec = Number(longJson.expires_in ?? 60 * 86400)

    // ③ 検証（saveThreadsAuth と同じ手順）
    const meResponse = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(longToken)}`)
    const me = await meResponse.json().catch(() => ({}))
    if (!meResponse.ok || !me.id) {
      console.error('threads-oauth: /me validation failed', me?.error?.message ?? me)
      return redirectWith(origin, 'validate_failed')
    }

    const keywordParams = new URLSearchParams({
      q: '印西市',
      search_type: 'RECENT',
      fields: 'id',
      limit: '1',
      access_token: longToken,
    })
    const keywordResponse = await fetch(`https://graph.threads.net/keyword_search?${keywordParams}`)
    const keywordSearchReady = keywordResponse.ok

    // ④ 保存（形式は saveThreadsAuth と同一）
    const { error } = await supabase.from('app_settings').upsert({
      key: 'sns_threads_auth',
      value: {
        user_id: String(me.id),
        access_token: longToken,
        username: String(me.username ?? ''),
        saved_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
        keyword_search_ready: keywordSearchReady,
        keyword_search_checked_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    if (error) {
      console.error('threads-oauth: save failed', error.message)
      return redirectWith(origin, 'save_failed')
    }

    revalidatePath('/admin/sns')
    const response = redirectWith(origin, keywordSearchReady ? 'ok_search' : 'ok_no_search')
    response.cookies.delete('threads_oauth_state')
    return response
  } catch (e) {
    console.error('threads-oauth: unexpected error', e)
    return redirectWith(origin, 'exchange_failed')
  }
}
