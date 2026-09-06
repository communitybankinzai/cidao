import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SIGNUP_SOURCE_COOKIE, isValidSignupSource } from '@/lib/signup-source'

// 新規登録とみなす猶予：auth.users の作成（＝members の自動作成）からこの時間内の初回ログインだけ signup_source を書く。
// 既存会員が登録QRを読んでログインし直しても「新規登録」に数えない
const NEW_MEMBER_WINDOW_MS = 30 * 60 * 1000

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') ?? ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  // メタバース印西（別オリジン）からログインしに来た場合は、/api/metaverse-auth が
  // Cookie に覚えた戻り先へ署名トークン付きで返す（2026-09-04 夜景タイムトライアルの参加制限）。
  // 初回ログイン（表示名の確認）を挟む場合は /me/edit の保存後に同じ Cookie を見て戻す（2026-09-06）
  const mvReturn = readCookie(request, 'mv_return') !== null
  const signupSource = readCookie(request, SIGNUP_SOURCE_COOKIE)
  const go = (path: string) => {
    const res = NextResponse.redirect(`${origin}${path}`)
    if (signupSource !== null) res.cookies.set(SIGNUP_SOURCE_COOKIE, '', { maxAge: 0, path: '/' })
    return res
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // 初回ログイン（プロフィール未確定）はLINE名がそのまま表示名になっているため、
      // 実名公開を防ぐ目的で表示名の確認・変更ページへ誘導する
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: member } = await supabase
          .from('members')
          .select('interests, deleted_at, created_at, signup_source')
          .eq('id', user.id)
          .single()
        // 登録経路の記録：作成直後の会員（＝いま初めて登録した人）で未記録なら、/login が Cookie に覚えた utm を残す
        if (member && !member.signup_source && !member.deleted_at && isValidSignupSource(signupSource) &&
            Date.now() - new Date(member.created_at).getTime() < NEW_MEMBER_WINDOW_MS) {
          await supabase.from('members').update({ signup_source: signupSource }).eq('id', user.id)
        }
        // 退会済みユーザーの再ログイン → アカウント復元（仕様書 v2.1：30日以内復元可。
        // 30日経過後の物理削除バッチが未実装のため、それまでは期限によらず復元する）
        if (member?.deleted_at) {
          await supabase.from('members').update({ deleted_at: null }).eq('id', user.id)
          return go(mvReturn ? '/api/metaverse-auth' : '/me?restored=1')
        }
        if (member && (member.interests ?? []).length === 0) {
          return go('/me/edit?welcome=1')
        }
      }
      if (mvReturn) return go('/api/metaverse-auth')
      return go(next)
    }
    return go(`/login?error=${encodeURIComponent(error.message)}`)
  }

  return go('/login?error=missing_code')
}
