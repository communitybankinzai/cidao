// 防災MAPの「💬 要望を送る」（2026-09-28）。
// POST（だれでも・匿名）：{ deviceId, body, lat?, lon?, zoom?, appVersion? } を1件保存する。
// GET（運営の合言葉のみ）：新しい順に一覧。?all=1 で伏せたものも。
// PATCH（運営の合言葉のみ）：?id= に { status: 'new'|'done' } または { hidden: boolean }。
// 保存先は disaster_map_feedback（migration 20260928140000）。一般には一覧を出さない（個人の書き込みを晒さないため）。
import { createHash } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
])

const MIGRATION_HINT = 'disaster_map_feedback table not found. Run migration 20260928140000.'
const MIN_BODY = 2
const MAX_BODY = 500
const MIN_INTERVAL_SECONDS = 60 // 同じ端末・同じ IP から続けて送れる間隔
const LIST_LIMIT = 300

// passed-roads と同じ合言葉（DISASTER_MODERATION_KEY、無ければ CRON_SECRET）
function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  if (!key) return false
  const given = request.headers.get('x-moderation-key') ?? ''
  return given.length >= 16 && given === key
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
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
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(error.message ?? '')
}

function ipHash(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || ''
  if (!ip) return ''
  return createHash('sha256').update(`map-feedback:${ip}`).digest('hex').slice(0, 32)
}

// 場所は任意。数値として正しく、日本の範囲に入るときだけ保存する（小数5桁＝約1m に丸める）
function optionalCoord(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return Math.round(n * 1e5) / 1e5
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function POST(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'not_configured' }, 503)
  let input: Record<string, unknown>
  try {
    input = await request.json()
  } catch {
    return json(request, { error: 'invalid_json' }, 400)
  }
  const deviceId = String(input.deviceId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) return json(request, { error: 'invalid_device' }, 400)
  // 制御文字を落とし、前後の空白を取る（改行は残す）
  const body = String(input.body ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (body.length < MIN_BODY) return json(request, { error: 'too_short' }, 400)
  if (body.length > MAX_BODY) return json(request, { error: 'too_long', max: MAX_BODY }, 400)

  const lat = optionalCoord(input.lat, 20, 46)
  const lon = optionalCoord(input.lon, 122, 154)
  const zoomRaw = Number(input.zoom)
  const zoom = lat !== null && lon !== null && Number.isFinite(zoomRaw) ? Math.max(0, Math.min(22, Math.round(zoomRaw))) : null
  const appVersion = String(input.appVersion ?? '').slice(0, 40)
  const hash = ipHash(request)

  const since = new Date(Date.now() - MIN_INTERVAL_SECONDS * 1000).toISOString()
  const recentFilter = hash ? `device_id.eq.${deviceId},ip_hash.eq.${hash}` : `device_id.eq.${deviceId}`
  const { data: recent, error: recentError } = await supabase
    .from('disaster_map_feedback')
    .select('created_at')
    .or(recentFilter)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
  if (recentError) {
    if (isMissingTable(recentError)) return json(request, { error: 'not_ready', hint: MIGRATION_HINT }, 503)
    return json(request, { error: 'db_error' }, 502)
  }
  if (recent && recent.length) {
    const latestAt = Date.parse(recent[0].created_at)
    const retryAfterSeconds = Math.max(1, Math.ceil((latestAt + MIN_INTERVAL_SECONDS * 1000 - Date.now()) / 1000))
    return json(request, { error: 'too_frequent', retryAfterSeconds }, 429)
  }

  const { error } = await supabase.from('disaster_map_feedback').insert({
    device_id: deviceId,
    body,
    lat: lat !== null && lon !== null ? lat : null,
    lon: lat !== null && lon !== null ? lon : null,
    zoom,
    app_version: appVersion,
    ip_hash: hash,
  })
  if (error) {
    if (isMissingTable(error)) return json(request, { error: 'not_ready', hint: MIGRATION_HINT }, 503)
    return json(request, { error: 'db_error' }, 502)
  }
  return json(request, { ok: true }, 201)
}

export async function GET(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'not_configured' }, 503)
  const url = new URL(request.url)
  let query = supabase
    .from('disaster_map_feedback')
    .select('id, created_at, device_id, body, lat, lon, zoom, app_version, status, hidden')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (!url.searchParams.has('all')) query = query.eq('hidden', false)
  const { data, error } = await query
  if (error) {
    if (isMissingTable(error)) return json(request, { error: 'not_ready', hint: MIGRATION_HINT }, 503)
    return json(request, { error: 'db_error' }, 502)
  }
  const items = (data ?? []).map(row => ({
    id: row.id,
    createdAt: row.created_at,
    // 同じ人の続けての要望が分かる程度に、端末IDの先頭だけ返す
    device: String(row.device_id).slice(0, 6),
    body: row.body,
    lat: row.lat,
    lon: row.lon,
    zoom: row.zoom,
    appVersion: row.app_version,
    status: row.status,
    hidden: row.hidden,
  }))
  return json(request, { items, newCount: items.filter(item => item.status === 'new' && !item.hidden).length })
}

export async function PATCH(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'not_configured' }, 503)
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, { error: 'invalid_id' }, 400)
  let input: Record<string, unknown>
  try {
    input = await request.json()
  } catch {
    return json(request, { error: 'invalid_json' }, 400)
  }
  const patch: { status?: string; hidden?: boolean } = {}
  if (input.status === 'new' || input.status === 'done') patch.status = input.status
  if (typeof input.hidden === 'boolean') patch.hidden = input.hidden
  if (!Object.keys(patch).length) return json(request, { error: 'nothing_to_change' }, 400)
  const { data, error } = await supabase.from('disaster_map_feedback').update(patch).eq('id', id).select('id')
  if (error) return json(request, { error: 'db_error' }, 502)
  if (!data || !data.length) return json(request, { error: 'not_found' }, 404)
  return json(request, { ok: true, id, ...patch })
}
