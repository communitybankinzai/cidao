// 防災MAP（と3Dワールド）で押された機能の回数（2026-09-28 事業主決定A：いらない機能を見極めるため）。
// POST：ページを閉じるときに navigator.sendBeacon（text/plain）で1回。同じ viewId は上書き（端末側で回数は増えるだけ）。
// GET：機能ごとの集計だけを返す（端末の乱数IDは返さない）。管理画面「３D・防災MAP」タブの「よく使う機能」が読む。
// 表は cbi_feature_uses（migration 20260928170000・90日で自動削除）。
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sanitizeFeatureCounts } from '@/lib/cbi-site-features'

export const dynamic = 'force-dynamic'
const origins = new Set(['https://communitybankinzai.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY = 16384

function headers(request: Request) {
  const origin = request.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store', Vary: 'Origin',
  }
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

export function OPTIONS(request: Request) { return new NextResponse(null, { status: 204, headers: headers(request) }) }

export async function POST(request: Request) {
  const h = headers(request)
  if (!origins.has(request.headers.get('origin') || '')) return NextResponse.json({ error: 'origin' }, { status: 403, headers: h })
  const text = await request.text()
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'size' }, { status: 413, headers: h })
  let body
  try { body = JSON.parse(text) } catch { return NextResponse.json({ error: 'json' }, { status: 400, headers: h }) }
  if (!body || !uuid.test(String(body.viewId)) || !uuid.test(String(body.visitorId)) || !['world', 'disaster-map'].includes(body.content))
    return NextResponse.json({ error: 'invalid event' }, { status: 400, headers: h })
  const device = ['mobile', 'desktop'].includes(body.device) ? body.device : ''
  const clean = sanitizeFeatureCounts(body.counts ?? {}, body.labels)
  if (!clean) return NextResponse.json({ error: 'invalid counts' }, { status: 400, headers: h })
  const client = db()
  if (!client) return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: h })
  const { error } = await client.from('cbi_feature_uses').upsert({
    view_id: body.viewId, visitor_id: body.visitorId, content: body.content, device,
    counts: clean.counts, labels: clean.labels, updated_at: new Date().toISOString(),
  }, { onConflict: 'view_id' })
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200, headers: h })
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const value = Number(params.get('days') || 30)
  const days = Number.isFinite(value) ? Math.max(1, Math.min(90, Math.floor(value))) : 30
  const content = params.get('content') === 'world' ? 'world' : 'disaster-map'
  const client = db()
  if (!client) return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: headers(request) })
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    client.rpc('cbi_feature_ranking', { p_days: days, p_content: content }),
    client.from('cbi_feature_uses').select('view_id', { count: 'exact', head: true }).eq('content', content).gte('created_at', since),
  ])
  if (error || countError) return NextResponse.json({ error: 'aggregation unavailable' }, { status: 503, headers: headers(request) })
  // 集計だけを返す（端末の乱数IDは返さない）
  return NextResponse.json({ days, content, visits: count ?? 0, trackingSince: '2026-09-28', ranking: data ?? [] }, { headers: headers(request) })
}
