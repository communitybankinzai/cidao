import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getTodayMapTilesUsage, jstToday } from '@/lib/map-tiles-usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// メタバース印西の画面に出す「本日の利用状況」（公開・認証不要）
// - todayRequests: 本日のタイルリクエスト数（Cloud Monitoring・120秒キャッシュ）
// - visitorsToday: 本日のユニーク利用者数（metaverse_presence_daily）
// - rootLimitPerDay: 費用ゼロ運用で設定した1日の閲覧開始枠（Console側で 30 に設定・2026-08-21）
// 数値以外は返さない（秘密情報なし）。取得できない項目は null。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
])
const ROOT_LIMIT_PER_DAY = 30

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=60',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request: Request) {
  const [usage, visitorsToday] = await Promise.all([getTodayMapTilesUsage(), countVisitorsToday()])
  return NextResponse.json(
    {
      date: jstToday(),
      todayRequests: usage?.todayRequests ?? null,
      requestsFetchedAt: usage?.fetchedAt ?? null,
      visitorsToday,
      rootLimitPerDay: ROOT_LIMIT_PER_DAY,
    },
    { headers: corsHeaders(request) },
  )
}

async function countVisitorsToday(): Promise<number | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!url || !key) return null
    const supabase = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { count, error } = await supabase
      .from('metaverse_presence_daily')
      .select('session_id', { count: 'exact', head: true })
      .eq('day', jstToday())
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}
