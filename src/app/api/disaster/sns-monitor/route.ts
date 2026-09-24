import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { runDisasterSnsMonitor } from '@/lib/disaster-sns-monitor'
import { processSnsRoadCandidates } from '@/lib/disaster-sns-road-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin)
      ? origin
      : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
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

function jstDayRange(value: string | null) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const date = valid ? value as string : formatter.format(new Date())
  const start = new Date(`${date}T00:00:00+09:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { date, start: start.toISOString(), end: end.toISOString() }
}

async function readMonitorState(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)

  const { searchParams } = new URL(request.url)
  const range = jstDayRange(searchParams.get('date'))
  const [{ data: candidates, error: candidateError }, { data: rules }, { data: latestRun }] = await Promise.all([
    supabase
      .from('disaster_sns_candidates')
      .select('id, platform, external_id, permalink, author_username, body_text, comments_text, media_url, posted_at, discovered_at, matched_query, latitude, longitude, location_name, review_status, raw_payload')
      .gte('posted_at', range.start)
      .lt('posted_at', range.end)
      .neq('review_status', 'dismissed')
      .order('posted_at', { ascending: false })
      .limit(100),
    supabase
      .from('disaster_sns_monitor_rules')
      .select('platform, query, enabled, last_scanned_at, last_status, last_error')
      .order('platform'),
    supabase
      .from('disaster_sns_scan_runs')
      .select('started_at, finished_at, status, discovered_count, result, error_message')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (candidateError) return json(request, { error: candidateError.message }, 500)
  const platformSummary = new Map<string, {
    platform: string
    enabled: boolean
    status: string
    lastScannedAt: string | null
    message: string
  }>()
  for (const rule of rules ?? []) {
    const current = platformSummary.get(rule.platform)
    const failed = rule.last_status === 'failed'
    platformSummary.set(rule.platform, {
      platform: rule.platform,
      enabled: Boolean(rule.enabled) || Boolean(current?.enabled),
      status: failed ? 'failed' : current?.status === 'failed' ? 'failed' : rule.last_status,
      lastScannedAt: [current?.lastScannedAt, rule.last_scanned_at].filter(Boolean).sort().pop() ?? null,
      message: failed ? String(rule.last_error ?? '') : current?.message ?? '',
    })
  }

  const items = (candidates ?? []).map((candidate) => ({
    id: candidate.id,
    platform: candidate.platform,
    externalId: candidate.external_id,
    permalink: candidate.permalink,
    username: candidate.author_username ?? '',
    // 市長・市公式など優先確認すべき発信元。巡回時に判定して raw_payload へ格納している
    priorityLabel: (candidate.raw_payload as { priority_label?: string } | null)?.priority_label ?? '',
    text: candidate.body_text ?? '',
    commentsText: candidate.comments_text ?? '',
    mediaUrl: candidate.media_url ?? '',
    timestamp: candidate.posted_at,
    discoveredAt: candidate.discovered_at,
    query: candidate.matched_query ?? '',
    locationName: candidate.location_name ?? '',
    lat: candidate.latitude,
    lng: candidate.longitude,
    reviewStatus: candidate.review_status,
  }))

  return json(request, {
    date: range.date,
    items,
    rules: (rules ?? []).map((rule) => ({
      platform: rule.platform,
      query: rule.query,
      enabled: Boolean(rule.enabled),
    })),
    platforms: Array.from(platformSummary.values()),
    lastRun: latestRun ?? null,
  })
}

async function getUncached(request: Request) {
  return readMonitorState(request)
}

export async function POST(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  try {
    const result = await runDisasterSnsMonitor(supabase)
    // 巡回のついでに、通行に触れた未判定の投稿を数件だけ AI に掛ける（2026-09-25・失敗しても巡回結果は返す）
    let roadReports: unknown = null
    try {
      roadReports = await processSnsRoadCandidates(supabase, { limit: 4 })
    } catch (roadError) {
      roadReports = { error: roadError instanceof Error ? roadError.message : String(roadError) }
      console.error('[disaster/sns-monitor] road reports', roadReports)
    }
    return json(request, { ...result, roadReports })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/sns-monitor]', message)
    return json(request, { error: message }, 500)
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// 一般向けの GET は Vercel の配信側で 120 秒だけ保存して使い回す（2026-09-22）。保存中の応答は関数を呼ばないので、
// 閲覧者が増えても呼び出し回数（無料枠 月100万回）が増えない。台風の日に75%の警告が来たための対策。
// 運営の一覧（?all=1）や合言葉付きの呼び出し、エラーの応答は保存しない
export async function GET(request: Request) {
  const response = await getUncached(request)
  const url = new URL(request.url)
  if (response.status === 200 && !url.searchParams.has('all') && !request.headers.get('x-moderation-key')) {
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=240')
  }
  return response
}
