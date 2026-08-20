import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// メタバース印西の同時利用者数（在席確認）
// クライアントが一定間隔で POST し、サーバーは直近 ACTIVE_SEC 秒以内の行数を返す。
// 保存するのは端末側で生成した乱数のセッションIDとモードのみ（個人情報なし）。
// 古い行は毎回のリクエストで掃除する（インデックス付きの軽い削除）。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
])

const ACTIVE_SEC = 90      // これ以内に合図があれば「参加中」
const STALE_MINUTES = 10   // これを過ぎた行は削除

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

type Counts = { total: number; event: number; bousai: number }

async function countActive(supabase: NonNullable<ReturnType<typeof adminClient>>): Promise<Counts> {
  const since = new Date(Date.now() - ACTIVE_SEC * 1000).toISOString()
  const { data, error } = await supabase
    .from('metaverse_presence')
    .select('mode')
    .gte('last_seen', since)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  return {
    total: rows.length,
    event: rows.filter((r) => r.mode !== 'bousai').length,
    bousai: rows.filter((r) => r.mode === 'bousai').length,
  }
}

// 参加中の人数を返すだけ（管理画面・表示専用）
export async function GET(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  try {
    return json(request, await countActive(supabase))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-presence GET]', message)
    return json(request, { error: message }, 502)
  }
}

// 在席の合図を受け取り、最新の人数を返す
export async function POST(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json(request, { error: 'invalid json' }, 400)
  }
  const sessionId = String(body.sessionId ?? '').slice(0, 64)
  const mode = String(body.mode ?? 'event') === 'bousai' ? 'bousai' : 'event'
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return json(request, { error: 'invalid session' }, 400)
  try {
    const { error } = await supabase
      .from('metaverse_presence')
      .upsert({ session_id: sessionId, mode, last_seen: new Date().toISOString() })
    if (error) throw new Error(error.message)
    // 古い行の掃除（放置しても数えないが、行数が増え続けるのを防ぐ）
    await supabase
      .from('metaverse_presence')
      .delete()
      .lt('last_seen', new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString())
    return json(request, await countActive(supabase))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-presence POST]', message)
    return json(request, { error: message }, 502)
  }
}
