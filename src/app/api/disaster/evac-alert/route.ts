// 印西市防災速報から「市の避難情報」（高齢者等避難・避難指示・緊急安全確保）を拾い、
// 防災MAPの地図上の警告帯に出すための API（2026-09-21）。
//
// - GET: 発令中の避難情報を新しい順に返す。解除の放送・発表から24時間経過で外す。
// - POST（運営のみ）: いま出ている放送を全員の画面から消す／戻す。
//   消すのは「その放送（publishedAt）」だけ。新しい放送が出れば自動で再び出る。
//   合言葉は冠水・通れた道 API と同じ DISASTER_MODERATION_KEY。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { CITY_PORTAL_URL, fetchOfficialUpdates } from '@/lib/inzai-city-alerts'
import { detectEvacAlerts } from '@/lib/inzai-evac-alert'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OFF_KEY = 'evac_alert_off'

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://127.0.0.1:8766',
  'http://localhost:8791',
  'http://localhost:8792',
  'http://localhost:8793',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Cache-Control': 'no-store',
  }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
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

function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  if (!key) return false
  const given = request.headers.get('x-moderation-key') ?? ''
  return given.length >= 16 && given === key
}

// 運営が消した放送（publishedAt の並び）。放送ごとに消す／戻す
type OffEntry = { publishedAt: string; offAt: string }

async function readOff(): Promise<OffEntry[]> {
  const supabase = serviceClient()
  if (!supabase) return []
  const { data } = await supabase.from('app_settings').select('value').eq('key', OFF_KEY).maybeSingle()
  const list = (data?.value as { entries?: OffEntry[] } | undefined)?.entries
  return Array.isArray(list) ? list.filter((e) => typeof e?.publishedAt === 'string') : []
}

export async function GET(request: Request) {
  try {
    const [updates, off] = await Promise.all([fetchOfficialUpdates(), readOff()])
    const { alerts, reason } = detectEvacAlerts(updates, Date.now())
    const offSet = new Set(off.map((e) => e.publishedAt))
    return json(request, {
      fetchedAt: new Date().toISOString(),
      alerts: alerts.map((a) => ({ ...a, suppressed: offSet.has(a.publishedAt) })),
      reason,
      source: { name: '印西市防災速報', url: CITY_PORTAL_URL },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/evac-alert]', message)
    return json(request, { error: message }, 502)
  }
}

// 本文 { off: true|false, publishedAt } で、その放送を消す／戻す
export async function POST(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const body = (await request.json().catch(() => ({}))) as { off?: boolean; publishedAt?: string }
  const publishedAt = String(body.publishedAt ?? '').slice(0, 40)
  if (!publishedAt) return json(request, { error: 'publishedAt_required' }, 400)
  const current = await readOff()
  // 古い記録は48時間で捨てる（放送は24時間で帯から消えるので、それ以上持つ意味がない）
  const recent = current.filter((e) => e.publishedAt !== publishedAt && Date.now() - Date.parse(e.offAt) < 48 * 3600_000)
  const entries = body.off ? [...recent, { publishedAt, offAt: new Date().toISOString() }] : recent
  const { error } = await supabase.from('app_settings').upsert({ key: OFF_KEY, value: { entries } })
  if (error) return json(request, { error: error.message }, 500)
  return json(request, { ok: true, publishedAt, off: !!body.off })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
