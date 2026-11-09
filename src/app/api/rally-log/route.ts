import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// 文化財ガイドツアー（cbi-site/metaverse/rally/）の「発話と質問の記録」
// ガイドの説明（say）・観光客の質問（ask）・質問への回答（answer）を残す。
// 名前・連絡先・位置情報は保存しない。ガイド育成の資料（よくある質問）に使う。
//   POST   { tour, spot?, kind, ja?, en?, replyTo? } → 保存 → 201 { id, createdAt }
//   GET    ?spot=<reportId>&limit=50                  → その文化財の ask / answer を新しい順（&all=1 で say も）
//   GET    ?tour=<code>&limit=200                     → そのツアーの全種別を古い順
//   DELETE ?id=<uuid>&tour=<code>                     → id と tour が一致する1行だけ削除 → { deleted }
// テーブル rally_tour_logs は service_role からだけ読み書きする（anon / authenticated は権限なし）。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8767',
  'http://127.0.0.1:8767',
])

const REPORT_ID_RE = /^[a-z0-9-]{3,60}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set(['say', 'ask', 'answer'])
const MAX_JA = 600
const MAX_EN = 1200

// 簡易の利用制限：IP ごとに 1 分あたり RATE_LIMIT 回まで。
// モジュール変数なのでインスタンスごとの目安であり、厳密ではない（複数インスタンスや再起動で数え直しになる）。
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const RATE_MAX_ENTRIES = 1000
const rateMap = new Map<string, { count: number; windowStart: number }>()

function rateLimited(request: Request): boolean {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  if (rateMap.size > RATE_MAX_ENTRIES) {
    // 古い窓のものを掃除する。それでも多ければ古い順（挿入順）に捨てる
    for (const [k, v] of rateMap) if (now - v.windowStart >= RATE_WINDOW_MS) rateMap.delete(k)
    for (const k of rateMap.keys()) {
      if (rateMap.size <= RATE_MAX_ENTRIES) break
      rateMap.delete(k)
    }
  }
  const cur = rateMap.get(ip)
  if (!cur || now - cur.windowStart >= RATE_WINDOW_MS) {
    rateMap.set(ip, { count: 1, windowStart: now })
    return false
  }
  cur.count++
  return cur.count > RATE_LIMIT
}

type LogRow = {
  id: string
  tour: string
  spot: string | null
  kind: string
  ja: string | null
  en: string | null
  reply_to: string | null
  created_at: string
}

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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

// ツアーコード：英数大文字4〜12に正規化（それ以外は null）
function normalizeTour(raw: unknown): string | null {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z0-9]{4,12}$/.test(c) ? c : null
}

function normalizeSpot(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return REPORT_ID_RE.test(s) ? s : null
}

// 文字列を trim して上限で切る。空なら null
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t ? t.slice(0, max) : null
}

function parseLimit(raw: string | null, def: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return def
  return Math.min(n, max)
}

function toItem(r: LogRow) {
  return { id: r.id, tour: r.tour, spot: r.spot, kind: r.kind, ja: r.ja, en: r.en, replyTo: r.reply_to, createdAt: r.created_at }
}

const COLS = 'id, tour, spot, kind, ja, en, reply_to, created_at'

export async function GET(request: Request) {
  if (rateLimited(request)) return json(request, { error: 'too many requests' }, 429)
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 500)
  const params = new URL(request.url).searchParams

  const tour = normalizeTour(params.get('tour'))
  if (tour) {
    // ツアー単位：全種別を古い順
    const limit = parseLimit(params.get('limit'), 200, 500)
    const { data, error } = await supabase.from('rally_tour_logs').select(COLS).eq('tour', tour).order('created_at', { ascending: true }).limit(limit)
    if (error) return json(request, { error: 'db error' }, 502)
    return json(request, { items: ((data ?? []) as LogRow[]).map(toItem) })
  }

  const spot = normalizeSpot(params.get('spot'))
  if (!spot) return json(request, { error: 'spot or tour required' }, 400)
  // 文化財単位：既定は ask / answer だけ。all=1 のときは say も含める。新しい順
  const limit = parseLimit(params.get('limit'), 50, 100)
  let q = supabase.from('rally_tour_logs').select(COLS).eq('spot', spot)
  if (params.get('all') !== '1') q = q.in('kind', ['ask', 'answer'])
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) return json(request, { error: 'db error' }, 502)
  return json(request, { items: ((data ?? []) as LogRow[]).map(toItem) })
}

export async function POST(request: Request) {
  if (rateLimited(request)) return json(request, { error: 'too many requests' }, 429)
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 500)
  let raw: unknown
  try { raw = await request.json() } catch { return json(request, { error: 'invalid json' }, 400) }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return json(request, { error: 'invalid json' }, 400)
  const body = raw as Record<string, unknown>

  const tour = normalizeTour(body.tour)
  if (!tour) return json(request, { error: 'tour required' }, 400)
  const kind = String(body.kind ?? '')
  if (!KINDS.has(kind)) return json(request, { error: 'invalid kind' }, 400)
  const ja = cleanText(body.ja, MAX_JA)
  const en = cleanText(body.en, MAX_EN)
  if (!ja && !en) return json(request, { error: 'ja or en required' }, 400)
  const spot = normalizeSpot(body.spot)
  // 回答（answer）だけが replyTo を持てる。say / ask では無視して null で保存する
  let replyTo: string | null = null
  if (kind === 'answer') {
    if (typeof body.replyTo !== 'string' || !UUID_RE.test(body.replyTo)) return json(request, { error: 'replyTo required for answer' }, 400)
    // 参照先は「同じツアーの ask」だけ（他ツアーの質問や、say / answer には紐付けられない）
    const { data: target, error: targetError } = await supabase.from('rally_tour_logs').select('id, tour, kind').eq('id', body.replyTo).maybeSingle()
    if (targetError) return json(request, { error: 'db error' }, 502)
    if (!target || target.tour !== tour || target.kind !== 'ask') return json(request, { error: 'replyTo must be an ask of the same tour' }, 400)
    replyTo = body.replyTo
  }

  const { data, error } = await supabase
    .from('rally_tour_logs')
    .insert({ tour, spot, kind, ja, en, reply_to: replyTo })
    .select('id, created_at')
    .single()
  if (error) {
    // 23503 = foreign_key_violation（replyTo の行が無い）
    if (error.code === '23503') return json(request, { error: 'replyTo not found' }, 400)
    return json(request, { error: 'db error' }, 502)
  }
  return json(request, { id: data.id, createdAt: data.created_at }, 201)
}

export async function DELETE(request: Request) {
  if (rateLimited(request)) return json(request, { error: 'too many requests' }, 429)
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 500)
  const params = new URL(request.url).searchParams
  const id = params.get('id') ?? ''
  const tour = normalizeTour(params.get('tour'))
  if (!UUID_RE.test(id) || !tour) return json(request, { error: 'id and tour required' }, 400)
  // id と tour が一致する1行だけ消す（他のツアーの記録は消せない）
  const { data, error } = await supabase.from('rally_tour_logs').delete().eq('id', id).eq('tour', tour).select('id')
  if (error) return json(request, { error: 'db error' }, 502)
  return json(request, { deleted: data?.length ?? 0 })
}
