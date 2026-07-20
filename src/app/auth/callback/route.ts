import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

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
          .select('interests, deleted_at')
          .eq('id', user.id)
          .single()
        // 退会済みユーザーの再ログイン → アカウント復元（仕様書 v2.1：30日以内復元可。
        // 30日経過後の物理削除バッチが未実装のため、それまでは期限によらず復元する）
        if (member?.deleted_at) {
          await supabase.from('members').update({ deleted_at: null }).eq('id', user.id)
          return NextResponse.redirect(`${origin}/me?restored=1`)
        }
        if (member && (member.interests ?? []).length === 0) {
          return NextResponse.redirect(`${origin}/me/edit?welcome=1`)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  return NextResponse.redirect(`${origin}/login?error=missing_code`)
}
