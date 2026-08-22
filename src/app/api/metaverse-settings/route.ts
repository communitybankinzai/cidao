import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// CBI管理画面（site/admin/ のメタバースタブ）からメタバースの表示設定を保存するAPI。
//
// 認証：管理画面のログインパスワードをそのまま照合する（2026-08-22 ユーザー選択）。
//   Vercel の環境変数 CBI_ADMIN_PASSWORD に、管理画面と同じパスワードを登録しておくこと。
//   未設定のときは 503 を返して機能を無効にする（誤って無認証で開かないため）。
// 読み取りは /api/metaverse-usage が maximumScreenSpaceError として返すので、ここには置かない。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// 長さの違いで早期に false を返さないよう、同じ長さに整えてから定数時間で比較する
function passwordMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    // 長さが違っても比較の時間を揃える（結果は必ず false）
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const headers = corsHeaders(request)
  const expected = process.env.CBI_ADMIN_PASSWORD ?? ''
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'サーバー側にパスワードが未設定です（Vercelの環境変数 CBI_ADMIN_PASSWORD）' },
      { status: 503, headers },
    )
  }

  let body: { password?: unknown; maximumScreenSpaceError?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'リクエストの形式が不正です' }, { status: 400, headers })
  }

  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || !passwordMatches(password, expected)) {
    // 失敗理由は返さない（総当たりの手がかりを与えない）
    return NextResponse.json({ ok: false, error: '認証に失敗しました' }, { status: 401, headers })
  }

  const sse = Math.round(Number(body.maximumScreenSpaceError))
  if (!Number.isFinite(sse) || sse < 2 || sse > 64) {
    return NextResponse.json(
      { ok: false, error: '描画精度は2〜64で指定してください（小さいほど鮮明）' },
      { status: 400, headers },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'サーバー接続が未設定です' }, { status: 503, headers })
  }

  const supabase = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'metaverse_render_quality', value: { maximumScreenSpaceError: sse } })
  if (error) {
    return NextResponse.json({ ok: false, error: '保存に失敗しました: ' + error.message }, { status: 500, headers })
  }

  return NextResponse.json({ ok: true, maximumScreenSpaceError: sse }, { headers })
}
