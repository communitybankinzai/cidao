import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getDailyMapTilesUsage, getTodayMapTilesUsage, jstToday } from '@/lib/map-tiles-usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// メタバース印西の画面に出す「本日の利用状況」（公開・認証不要）
// - todayRequests: 本日のタイルリクエスト数（Cloud Monitoring・120秒キャッシュ）
// - visitorsToday: 本日のユニーク利用者数（metaverse_presence_daily）
// - rootLimitPerDay: 費用ゼロ運用で設定した1日の閲覧開始枠（Console側で 30 に設定・2026-08-21）
// - daily（?days=N 指定時のみ・1〜90）: 日別の利用者数（event/bousai 内訳）とタイルリクエスト数。管理画面のグラフ用
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
  const daysParam = Number(new URL(request.url).searchParams.get('days') ?? '')
  const days = Number.isFinite(daysParam) && daysParam >= 1 ? Math.min(90, Math.floor(daysParam)) : 0
  const [usage, visitorsToday, daily] = await Promise.all([
    getTodayMapTilesUsage(),
    countVisitorsToday(),
    days ? buildDaily(days) : Promise.resolve(undefined),
  ])
  return NextResponse.json(
    {
      date: jstToday(),
      todayRequests: usage?.todayRequests ?? null,
      requestsFetchedAt: usage?.fetchedAt ?? null,
      visitorsToday,
      rootLimitPerDay: ROOT_LIMIT_PER_DAY,
      ...(daily !== undefined ? { daily } : {}),
    },
    { headers: corsHeaders(request) },
  )
}

type DailyRow = { day: string; visitors: number; event: number; bousai: number; requests: number | null }

// 直近 days 日（今日を含む）の日別集計。データの無い日も 0 で埋めて連続した配列にする
async function buildDaily(days: number): Promise<DailyRow[]> {
  const today = jstToday()
  const labels: string[] = []
  const t0 = new Date(today + 'T00:00:00Z').getTime()
  for (let i = days - 1; i >= 0; i--) labels.push(new Date(t0 - i * 86_400_000).toISOString().slice(0, 10))
  const [visitors, requests] = await Promise.all([countVisitorsByDay(labels[0]), getDailyMapTilesUsage(days)])
  const reqMap = new Map((requests ?? []).map((r) => [r.day, r.requests]))
  return labels.map((day) => {
    const v = visitors?.get(day)
    return {
      day,
      visitors: v ? v.event + v.bousai : 0,
      event: v?.event ?? 0,
      bousai: v?.bousai ?? 0,
      requests: requests ? (reqMap.get(day) ?? 0) : null,
    }
  })
}

async function countVisitorsByDay(fromDay: string): Promise<Map<string, { event: number; bousai: number }> | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!url || !key) return null
    const supabase = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase
      .from('metaverse_presence_daily')
      .select('day, mode')
      .gte('day', fromDay)
      .limit(20000)
    if (error) return null
    const map = new Map<string, { event: number; bousai: number }>()
    for (const row of data ?? []) {
      const day = String(row.day)
      const cur = map.get(day) ?? { event: 0, bousai: 0 }
      if (row.mode === 'bousai') cur.bousai += 1
      else cur.event += 1
      map.set(day, cur)
    }
    return map
  } catch {
    return null
  }
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
