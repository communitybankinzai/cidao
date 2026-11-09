import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// 文化財スタンプラリー（cbi-site/metaverse/rally/）のスタンプ帳
// 観光客は CiDAO に登録できないので、「スタンプ帳コード」だけで続きから集められるようにする。
// 保存するのはコードと取ったスタンプ（reportId → 日時・丸めた座標）だけ。名前・連絡先・端末情報は持たない。
//   GET  ?code=XXXXXXXX            → { code, stamps, updatedAt }（無ければ 404）
//   POST { stamps }                → 新しいコードを発行して保存 → { code, stamps }
//   POST { code, stamps }          → 既存のスタンプ帳に和集合で追記（先に取った方の日時を残す）→ { code, stamps }
// テーブル rally_books は service_role からだけ読み書きする（anon / authenticated は権限なし）。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8767',
  'http://127.0.0.1:8767',
])

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 見間違えやすい I O 0 1 L を除く
const CODE_LEN = 8
const MAX_STAMPS = 60               // 文化財は50件。少し余裕を持たせる
const REPORT_ID_RE = /^[a-z0-9-]{3,60}$/

type Stamp = { at: string; lat?: number | null; lon?: number | null }
type Stamps = Record<string, Stamp>

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

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

function normalizeCode(raw: unknown): string | null {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z0-9]{8,12}$/.test(c) ? c : null
}

function newCode(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return s
}

// クライアントから来たスタンプを検査して、保存できる形だけ残す
function sanitizeStamps(raw: unknown): Stamps {
  const out: Stamps = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!REPORT_ID_RE.test(id)) continue
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const at = new Date(String(o.at ?? ''))
    if (Number.isNaN(at.getTime())) continue
    const lat = Number(o.lat), lon = Number(o.lon)
    out[id] = {
      at: at.toISOString(),
      lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? Math.round(lat * 1e4) / 1e4 : null,
      lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? Math.round(lon * 1e4) / 1e4 : null,
    }
    if (Object.keys(out).length >= MAX_STAMPS) break
  }
  return out
}

// 和集合。同じ文化財は先に取った方（古い日時）を残す
function mergeStamps(a: Stamps, b: Stamps): Stamps {
  const out: Stamps = { ...a }
  for (const [id, st] of Object.entries(b)) {
    const cur = out[id]
    if (!cur || new Date(st.at).getTime() < new Date(cur.at).getTime()) out[id] = st
  }
  return out
}

export async function GET(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 500)
  const code = normalizeCode(new URL(request.url).searchParams.get('code'))
  if (!code) return json(request, { error: 'code required' }, 400)
  const { data, error } = await supabase.from('rally_books').select('code, stamps, updated_at').eq('code', code).maybeSingle()
  if (error) return json(request, { error: 'db error' }, 502)
  if (!data) return json(request, { error: 'not found' }, 404)
  return json(request, { code: data.code, stamps: (data.stamps ?? {}) as Stamps, updatedAt: data.updated_at })
}

export async function POST(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 500)
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { return json(request, { error: 'invalid json' }, 400) }
  const incoming = sanitizeStamps(body.stamps)
  const code = normalizeCode(body.code)

  if (code) {
    const { data, error } = await supabase.from('rally_books').select('code, stamps').eq('code', code).maybeSingle()
    if (error) return json(request, { error: 'db error' }, 502)
    if (!data) return json(request, { error: 'not found' }, 404)
    const merged = mergeStamps((data.stamps ?? {}) as Stamps, incoming)
    const { error: upErr } = await supabase
      .from('rally_books')
      .update({ stamps: merged, updated_at: new Date().toISOString() })
      .eq('code', code)
    if (upErr) return json(request, { error: 'db error' }, 502)
    return json(request, { code, stamps: merged })
  }

  // 新規発行。コードが偶然かぶったら作り直す（31^8 ≈ 8500億通りなのでまず起きない）
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = newCode()
    const { error } = await supabase.from('rally_books').insert({ code: c, stamps: incoming })
    if (!error) return json(request, { code: c, stamps: incoming }, 201)
    if (error.code !== '23505') return json(request, { error: 'db error' }, 502) // 23505 = unique_violation
  }
  return json(request, { error: 'could not issue code' }, 503)
}
