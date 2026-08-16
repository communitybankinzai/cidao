// Threads の OAuth 再認証を開始する（管理者専用）。
// トークン生成ツール（Meta開発者コンソール）は要求スコープが5項目に固定されており
// threads_keyword_search を含むトークンを発行できないため、
// 認可URLを自前で組み立ててスコープを明示指定する。
// 参照: https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// 現行の投稿・返信・インサイト権限（トークン生成ツールと同等）＋公開投稿検索
const THREADS_OAUTH_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_read_replies',
  'threads_manage_replies',
  'threads_manage_insights',
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
