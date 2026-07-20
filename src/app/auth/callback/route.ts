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
          .select('interests')
          .eq('id', user.id)
          .single()
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
