// Threads の検索専用 OAuth 認可を開始する（管理者専用）。
// 投稿用アプリはダッシュボードのフォーム破損でコールバックURLを登録できず、
// トークン生成ツールも threads_keyword_search を要求できない（2026-08-17実証）。
// このため公開投稿検索は「検索専用に新規作成したThreadsアプリ」で認可する。
// 投稿用トークン（sns_threads_auth）には一切触らない。
// 参照: https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// 検索専用アプリに必要な最小スコープ
const THREADS_OAUTH_SCOPES = [
  'threads_basic',
  'threads_keyword_search',
].join(',')

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: isAdmin } = user ? await supabase.rpc('is_admin') : { data: false }
  const origin = new URL(request.url).origin
  if (!user || !isAdmin) {
    return NextResponse.redirect(`${origin}/login?next=/admin/sns`)
  }

  const { data: appRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sns_threads_app')
    .maybeSingle()
  const app = appRow?.value as { app_id?: string; app_secret?: string } | null
  if (!app?.app_id || !app?.app_secret) {
    return NextResponse.redirect(`${origin}/admin/sns?threads_oauth=app_missing`)
  }

  // CSRF対策: stateをCookieに残し、コールバックで突合する
  const state = crypto.randomUUID()
  const authorizeUrl = new URL('https://threads.net/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', app.app_id)
  authorizeUrl.searchParams.set('redirect_uri', `${origin}/api/admin/sns/threads-oauth/callback`)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', THREADS_OAUTH_SCOPES)
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set('threads_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/admin/sns/threads-oauth',
    maxAge: 600,
  })
  return response
}
