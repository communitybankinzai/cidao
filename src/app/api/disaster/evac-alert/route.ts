// 印西市防災速報から「市の避難情報」（高齢者等避難・避難指示・緊急安全確保）を拾い、
// 防災MAPの地図上の警告帯に出すための API（2026-09-21）。
//
// - GET: 最新の避難情報を1件返す。解除の放送・発表から24時間経過で出さない。
// - POST（運営のみ）: いま出ている放送を全員の画面から消す／戻す。
//   消すのは「その放送（publishedAt）」だけ。新しい放送が出れば自動で再び出る。
//   合言葉は冠水・通れた道 API と同じ DISASTER_MODERATION_KEY。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { CITY_PORTAL_URL, fetchOfficialUpdates, type OfficialUpdate } from '@/lib/inzai-city-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OFF_KEY = 'evac_alert_off'
const EXPIRE_HOURS = 24

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

type OffState = { publishedAt: string; offAt: string } | null

async function readOff(): Promise<OffState> {
  const supabase = serviceClient()
  if (!supabase) return null
  const { data } = await supabase.from('app_settings').select('value').eq('key', OFF_KEY).maybeSingle()
  const value = data?.value as { publishedAt?: string; offAt?: string } | undefined
  return value?.publishedAt ? { publishedAt: value.publishedAt, offAt: value.offAt ?? '' } : null
}

// 強い順。1つの放送に複数あれば強いほうを採る
const LEVELS = [
  { level: 5, label: '緊急安全確保' },
  { level: 4, label: '避難指示' },
  { level: 3, label: '高齢者等避難' },
] as const

const KEYWORD = /(緊急安全確保|避難指示|高齢者等避難)/
// 「避難指示を解除し、高齢者等避難を発令」のような放送は、解除した側を取り除いてから判定する
const CANCELLED = /(緊急安全確保|避難指示|高齢者等避難)[^。\n]{0,20}?解除/g

// 防災速報の日時は「2026/09/21 14:30:01」（日本時間・タイムゾーン表記なし）
function parsePublishedAt(value: string) {
  const m = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +(m[6] ?? 0))
}

// 「土砂災害警戒区域および土砂災害のおそれがある箇所に対し」→ 対象の部分だけ
function extractArea(message: string) {
  const m = message.replace(/\s+/g, '').match(/([^。、「」]{2,60}?(?:区域|地区|箇所|地域|全域)[^。「」]{0,40}?)(?:に対し|を対象|に、|に「)/)
  return m ? m[1].replace(/^(?:本日|また|なお)?[、]?/, '') : ''
}

function detect(updates: OfficialUpdate[], now: number) {
  const relevant = updates
    .filter((u) => KEYWORD.test(`${u.title}\n${u.message}`))
    .sort((a, b) => parsePublishedAt(b.publishedAt) - parsePublishedAt(a.publishedAt))
  const latest = relevant[0]
  if (!latest) return { alert: null, reason: 'none' as const }
  const publishedMs = parsePublishedAt(latest.publishedAt)
  if (Number.isFinite(publishedMs) && now - publishedMs > EXPIRE_HOURS * 3600_000) {
    return { alert: null, reason: 'expired' as const }
  }
  const text = `${latest.title}\n${latest.message}`
  const remaining = text.replace(CANCELLED, '')
  const found = LEVELS.find((l) => remaining.includes(l.label))
  if (!found) return { alert: null, reason: 'cancelled' as const }
  return {
    reason: 'active' as const,
    alert: {
      level: found.level,
      label: found.label,
      area: extractArea(latest.message),
      title: latest.title,
      message: latest.message,
      publishedAt: latest.publishedAt,
      sourceUrl: latest.sourceUrl || CITY_PORTAL_URL,
    },
  }
}

export async function GET(request: Request) {
  try {
    const [updates, off] = await Promise.all([fetchOfficialUpdates(), readOff()])
    const { alert, reason } = detect(updates, Date.now())
    const suppressed = !!(alert && off && off.publishedAt === alert.publishedAt)
    return json(request, {
      fetchedAt: new Date().toISOString(),
      alert,
      reason,
      suppressed,
      off,
      source: { name: '印西市防災速報', url: CITY_PORTAL_URL },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/evac-alert]', message)
    return json(request, { error: message }, 502)
  }
}

// 本文 { off: true, publishedAt } で消す、{ off: false } で戻す
export async function POST(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const body = (await request.json().catch(() => ({}))) as { off?: boolean; publishedAt?: string }
  const publishedAt = String(body.publishedAt ?? '').slice(0, 40)
  if (body.off && !publishedAt) return json(request, { error: 'publishedAt_required' }, 400)
  const value = body.off ? { publishedAt, offAt: new Date().toISOString() } : {}
  const { error } = await supabase.from('app_settings').upsert({ key: OFF_KEY, value })
  if (error) return json(request, { error: error.message }, 500)
  return json(request, { ok: true, off: body.off ? value : null })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
