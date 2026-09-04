import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { signMetaverseToken } from '@/lib/metaverse-token'

// メタバース印西（GitHub Pages・別オリジン）が「CiDAO 登録者だけ遊べる」機能を出すための橋渡し。
//   GET /api/metaverse-auth?return=<メタバースのURL>
//   - ログイン済み → 会員の表示名を入れた署名トークンを URL フラグメント（#mtoken=...）に付けて return へ戻す
//   - 未ログイン → return を Cookie に覚えて /login へ。auth/callback がログイン後にここへ戻す
// トークンは 24 時間有効。検証は /api/metaverse-tt（コース night の start）で行う。
// return 先は許可したオリジンだけ（トークンを他所へ流さないため）。
const RETURN_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8765',
])
const RETURN_COOKIE = 'mv_return'

function allowedReturn(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (!RETURN_ORIGINS.has(u.origin)) return null
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const cookieStore = await cookies()
  const ret = allowedReturn(searchParams.get('return')) ?? allowedReturn(cookieStore.get(RETURN_COOKIE)?.value ?? null)
  if (!ret) {
    return NextResponse.json({ error: 'invalid return url' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const res = NextResponse.redirect(`${origin}/login?next=/api/metaverse-auth`)
    res.cookies.set(RETURN_COOKIE, ret, { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https'), maxAge: 600, path: '/' })
    return res
  }

  const { data: member } = await supabase
    .from('members')
    .select('display_name, deleted_at')
    .eq('id', user.id)
    .single()
  if (!member || member.deleted_at) {
    return NextResponse.redirect(`${origin}/login?next=/api/metaverse-auth`)
  }
  const nick = String(member.display_name ?? '').trim().slice(0, 20) || '名無しさん'
  const token = signMetaverseToken({ uid: user.id, nick, exp: Date.now() + 24 * 60 * 60 * 1000 })
  const res = NextResponse.redirect(`${ret}#mtoken=${encodeURIComponent(token)}`)
  res.cookies.set(RETURN_COOKIE, '', { maxAge: 0, path: '/' })
  return res
}
