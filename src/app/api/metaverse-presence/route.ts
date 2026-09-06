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
  'http://localhost:4173',
  'http://127.0.0.1:4173',
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

type Counts = { total: number; event: number; bousai: number; disasterMap: number }

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
    // 3Dワールド側の内訳。防災MAP(disaster-map)は3Dを使わないため event に含めない
    event: rows.filter((r) => r.mode !== 'bousai' && r.mode !== 'disaster-map').length,
    bousai: rows.filter((r) => r.mode === 'bousai').length,
    disasterMap: rows.filter((r) => r.mode === 'disaster-map').length,
  }
}

// 本日（JST）のユニーク訪問者数。metaverse_presence_daily から mode 別に数える
async function countToday(supabase: NonNullable<ReturnType<typeof adminClient>>): Promise<Counts> {
  const jstDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  const { data, error } = await supabase
    .from('metaverse_presence_daily')
    .select('mode')
    .eq('day', jstDay)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  return {
    total: rows.length,
    event: rows.filter((r) => r.mode !== 'bousai' && r.mode !== 'disaster-map').length,
    bousai: rows.filter((r) => r.mode === 'bousai').length,
    disasterMap: rows.filter((r) => r.mode === 'disaster-map').length,
  }
}

// 参加中の人数と本日のユニーク訪問者数を返す（管理画面・表示専用）
export async function GET(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  try {
    const [now, today] = await Promise.all([countActive(supabase), countToday(supabase)])
    return json(request, { ...now, today })
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
  const rawMode = String(body.mode ?? 'event')
  const mode = rawMode === 'bousai' ? 'bousai' : rawMode === 'disaster-map' ? 'disaster-map' : 'event'
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return json(request, { error: 'invalid session' }, 400)
  try {
    const { error } = await supabase
      .from('metaverse_presence')
      .upsert({ session_id: sessionId, mode, last_seen: new Date().toISOString() })
    if (error) throw new Error(error.message)
    // 日別ユニーク人数の蓄積（アクセス分析でタイルリクエスト数と重ねるため）。
    // 同じ日・同じセッションは1回だけ数える。失敗しても在席表示は止めない
    const jstDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
    await supabase
      .from('metaverse_presence_daily')
      .upsert(
        { day: jstDay, session_id: sessionId, mode },
        { onConflict: 'day,session_id', ignoreDuplicates: true },
      )
    // 古い行の掃除（放置しても数えないが、行数が増え続けるのを防ぐ）
    await supabase
      .from('metaverse_presence')
      .delete()
      .lt('last_seen', new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString())
    const [now, today] = await Promise.all([countActive(supabase), countToday(supabase)])
    return json(request, { ...now, today })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-presence POST]', message)
    return json(request, { error: message }, 502)
  }
}
