// SNS投稿から AI が読み取った通行情報（未確認）。
// GET  : 一般向け（confidence=high・hidden=false だけ・120秒の配信キャッシュ）。?all=1＋合言葉で運営向け全件
// POST : 未判定の候補を AI に掛ける（合言葉か CRON_SECRET）。?limit= で件数（既定6・最大60）
// PATCH: ?id=… {hidden:true|false} 運営が伏せる／戻す（合言葉）
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { processSnsRoadCandidates, SNS_ROAD_EVENT_START, SNS_ROAD_TABLE, toPublicReport } from '@/lib/disaster-sns-road-ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173', 'http://localhost:4173',
  'http://127.0.0.1:8766', 'http://localhost:8766',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Access-Control-Max-Age': '86400', Vary: 'Origin', 'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// 通れた道APIと同じ合言葉（DISASTER_MODERATION_KEY、無ければ CRON_SECRET）
function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  const given = request.headers.get('x-moderation-key') ?? ''
  return Boolean(key) && given.length >= 16 && given === key
}

function isCron(request: Request) {
  const secret = process.env.CRON_SECRET ?? ''
  const auth = request.headers.get('authorization') ?? ''
  return Boolean(secret) && auth === `Bearer ${secret}`
}

export async function GET(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const url = new URL(request.url)
  const wantAll = url.searchParams.has('all')
  if (wantAll && !isModerator(request)) return json(request, { error: 'forbidden' }, 403)

  let query = supabase.from(SNS_ROAD_TABLE)
    .select('id, kind, latitude, longitude, location_name, location_basis, observed_at, posted_at, permalink, platform, confidence, summary, quote, hidden, image_note, embed_url')
    .gte('posted_at', SNS_ROAD_EVENT_START).order('posted_at', { ascending: false }).limit(500)
  if (!wantAll) query = query.eq('hidden', false).eq('confidence', 'high')
  const { data, error } = await query
  if (error) return json(request, { error: 'read_failed' }, 500)

  const response = json(request, {
    generatedAt: new Date().toISOString(),
    eventStart: SNS_ROAD_EVENT_START,
    count: (data ?? []).length,
    reports: (data ?? []).map((row) => toPublicReport(row as Record<string, unknown>)),
    note: 'SNSの投稿をAIが読み取った未確認の情報です。点は投稿が指す場所の目安で、いま通れるかどうかを保証しません。',
  })
  // 一般向けだけ配信側で120秒使い回す（無料枠の呼び出し回数対策。sns-monitor と同じ考え）
  if (!wantAll) response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=240')
  return response
}

export async function POST(request: Request) {
  if (!isModerator(request) && !isCron(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 6)
  try {
    const result = await processSnsRoadCandidates(supabase, { limit: Number.isFinite(limit) ? limit : 6 })
    return json(request, { ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/sns-road-reports]', message)
    return json(request, { error: message }, 500)
  }
}

export async function PATCH(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(request, { error: 'invalid_id' }, 400)
  let body: { hidden?: unknown }
  try { body = await request.json() } catch { return json(request, { error: 'invalid_json' }, 400) }
  if (typeof body?.hidden !== 'boolean') return json(request, { error: 'invalid_hidden' }, 400)
  const { data, error } = await supabase.from(SNS_ROAD_TABLE)
    .update({ hidden: body.hidden, updated_at: new Date().toISOString() }).eq('id', id).select('id, hidden').maybeSingle()
  if (error) return json(request, { error: 'update_failed' }, 500)
  if (!data) return json(request, { error: 'not_found' }, 404)
  return json(request, { ok: true, id: data.id, hidden: data.hidden })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
