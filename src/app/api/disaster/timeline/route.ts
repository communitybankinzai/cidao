// 災害タイムライン API。
// GET : GitHub Pages の災害MAPが読む（date=YYYY-MM-DD, days=1..7）
// POST: Supabase pg_cron が 10 分ごとに叩く巡回（情報源を順に取得して保存）
// テーブル未作成時は 500 ではなく 503 でマイグレーション実行の案内を返す。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runDisasterTimeline } from '@/lib/disaster-timeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
])

const MIGRATION_HINT = 'disaster_timeline tables not found. Run migration 20260823120000 in Supabase SQL Editor.'

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin)
      ? origin
      : 'https://communitybankinzai.github.io',
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

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// PostgREST がテーブル未定義を返すときのコード（42P01）／スキーマキャッシュ未反映（PGRST205）
function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST200') return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(error.message ?? '')
}

function jstRange(dateParam: string | null, daysParam: string | null) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '') ? (dateParam as string) : formatter.format(new Date())
  const days = Math.min(7, Math.max(1, Number.parseInt(daysParam ?? '1', 10) || 1))
  const end = new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000)
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return { date, days, start: start.toISOString(), end: end.toISOString() }
}

export async function GET(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)

  const { searchParams } = new URL(request.url)
  const range = jstRange(searchParams.get('date'), searchParams.get('days'))

  const [{ data: sources, error: sourcesError }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from('disaster_info_sources')
      .select('id, label, kind, enabled, trust, last_fetched_at, last_status, last_error')
      .order('sort_order')
      .order('created_at'),
    supabase
      .from('disaster_timeline_items')
      .select('id, source_id, occurred_at, title, body, url, area_tag, change_type, priority')
      .gte('occurred_at', range.start)
      .lt('occurred_at', range.end)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ])

  if (isMissingTable(sourcesError) || isMissingTable(itemsError)) {
    return json(request, { error: MIGRATION_HINT }, 503)
  }
  if (sourcesError) return json(request, { error: sourcesError.message }, 500)
  if (itemsError) return json(request, { error: itemsError.message }, 500)

  const sourceById = new Map((sources ?? []).map((source) => [source.id as string, source]))
  const itemCount = new Map<string, number>()
  for (const item of items ?? []) {
    itemCount.set(item.source_id, (itemCount.get(item.source_id) ?? 0) + 1)
  }

  return json(request, {
    date: range.date,
    days: range.days,
    generatedAt: new Date().toISOString(),
    items: (items ?? []).map((item) => {
      const source = sourceById.get(item.source_id)
      return {
        id: item.id,
        occurredAt: item.occurred_at,
        sourceId: item.source_id,
        sourceLabel: source?.label ?? '',
        sourceKind: source?.kind ?? '',
        trust: source?.trust ?? 'unverified',
        title: item.title,
        body: item.body,
        url: item.url,
        areaTag: item.area_tag,
        changeType: item.change_type,
        priority: item.priority,
      }
    }),
    sources: (sources ?? []).map((source) => ({
      id: source.id,
      label: source.label,
      kind: source.kind,
      enabled: Boolean(source.enabled),
      trust: source.trust,
      lastFetchedAt: source.last_fetched_at,
      lastStatus: source.last_status,
      lastError: source.last_error,
      itemCount: itemCount.get(source.id) ?? 0,
    })),
  })
}

export async function POST(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  try {
    const result = await runDisasterTimeline(supabase, { claim: true, minIntervalSeconds: 240 })
    return json(request, result)
  } catch (error) {
    const err = error as { code?: string; message?: string }
    if (isMissingTable(err)) return json(request, { error: MIGRATION_HINT }, 503)
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/timeline]', message)
    return json(request, { error: message }, 500)
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
