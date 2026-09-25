// 防災MAP「🚧 通行止め（役所の発表）」へ配る。
//
// 取り込みと解除は災害タイムラインの巡回（src/lib/disaster-road-closures.ts）が行い、ここは読むだけ。
// 返すのは印西市とその周辺（in_area）の件のうち、通行止め中のものと、24時間以内に解除されたもの。
// 役所の題名（source_title）は画面に出さないので返さない。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ROAD_CLOSURE_KINDS } from '@/lib/disaster-road-closures'
import { runRoadClosures } from '@/lib/disaster-timeline'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const RECENT_CLEARED_HOURS = 24

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    Vary: 'Origin',
    // 巡回は毎時なので、CDN で5分まとめても十分新しい（Vercel の Active CPU を節約）
    'Cache-Control': 'public, max-age=60, s-maxage=300',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...corsHeaders(request), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  })
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Row = {
  id: string
  source_id: string
  road: string
  place: string
  reason: string
  municipality: string
  url: string | null
  published_at: string | null
  first_seen_at: string
  last_seen_at: string
  cleared_at: string | null
  clear_reason: string | null
  path: unknown
  raw: { mapUrl?: unknown; periodEnd?: unknown; cityPath?: unknown } | null
}

// 役所のページを読み直す（pg_cron が毎時呼ぶ）。情報源ごとに前回から50分空けるので、何度呼ばれても役所への取得は増えない
export async function POST(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503 })
  try {
    // 県の道路規制状況図の見張りは 2026-09-26 に /api/disaster/pref-road-kisei（30分ごと）へ分けた
    const results = await runRoadClosures(supabase)
    return NextResponse.json({ ranAt: new Date().toISOString(), results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/road-closures]', message)
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function GET(request: Request) {
  const headers = corsHeaders(request)
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503, headers })

  const since = new Date(Date.now() - RECENT_CLEARED_HOURS * 3600 * 1000).toISOString()
  const [{ data: sources, error: sourceError }, { data: rows, error: rowError }] = await Promise.all([
    supabase
      .from('disaster_info_sources')
      .select('id, kind, label, url, enabled, last_fetched_at, last_status, last_error')
      .in('kind', ROAD_CLOSURE_KINDS as unknown as string[]),
    supabase
      .from('disaster_road_closures')
      .select('id, source_id, road, place, reason, municipality, url, published_at, first_seen_at, last_seen_at, cleared_at, clear_reason, path, raw')
      .eq('in_area', true)
      .or(`cleared_at.is.null,cleared_at.gte.${since}`)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(200),
  ])
  if (sourceError || rowError) {
    const message = (sourceError ?? rowError)?.message ?? 'unknown'
    return NextResponse.json({ error: message }, { status: 502, headers })
  }

  const sourceById = new Map((sources ?? []).map((s) => [s.id as string, s]))
  const toItem = (row: Row) => {
    const source = sourceById.get(row.source_id)
    // 線は2通り：運営が位置を確かめた線（path）と、役所が座標付きで公開した線（raw.cityPath・佐倉市のマイマップなど）
    const own = Array.isArray(row.path) && row.path.length >= 2 ? row.path : null
    const city = Array.isArray(row.raw?.cityPath) && row.raw.cityPath.length >= 2 ? row.raw.cityPath : null
    const path = own ?? city
    const pathSource = own ? 'operator' : city ? 'city' : null
    return {
      id: row.id,
      road: row.road,
      place: row.place,
      reason: row.reason,
      municipality: row.municipality,
      url: row.url,
      // 役所が付けた位置図（印西市の記事の PDF など）。線の無い件の場所の手がかり
      mapUrl: typeof row.raw?.mapUrl === 'string' && /^https:\/\//.test(row.raw.mapUrl) ? row.raw.mapUrl : null,
      publishedAt: row.published_at,
      // 役所が示した規制期間の終わり（印旛土木事務所の工事など）。無ければ null＝解除の発表まで
      periodEnd: typeof row.raw?.periodEnd === 'string' ? row.raw.periodEnd : null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      clearedAt: row.cleared_at,
      clearReason: row.clear_reason,
      sourceLabel: (source?.label as string | undefined) ?? '',
      sourceKind: (source?.kind as string | undefined) ?? '',
      path,
      pathSource,
    }
  }
  const items = ((rows ?? []) as Row[])
    .filter((row) => sourceById.get(row.source_id)?.enabled !== false)
    .map(toItem)

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    active: items.filter((item) => !item.clearedAt),
    recentlyCleared: items.filter((item) => item.clearedAt),
    sources: (sources ?? []).filter((s) => s.enabled).map((s) => ({
      label: s.label,
      kind: s.kind,
      url: s.url,
      lastFetchedAt: s.last_fetched_at,
      lastStatus: s.last_status,
      lastError: s.last_status === 'failed' ? String(s.last_error ?? '').slice(0, 200) : null,
    })),
  }, { headers })
}
