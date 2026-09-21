// 「みんなでつくる千葉豪雨冠水道路マップ」（有志プロジェクト）の投稿を、印西市域だけ取り出して返す。
//
// 先方は静的JSON（全県 5,000件超・約1.3MB）を配信しているが、
// 閲覧者のブラウザから直接取りにいくと人数分のリクエストが先方サーバーへ飛ぶ。
// 先方の利用規約は「スクリプト等による大量リクエスト」を禁じているため、
// ここで受けて 10 分キャッシュし、印西市域に絞って小さくして配る。
// これにより閲覧者が何人でも、先方への取得は 10 分に 1 回で済む。
//
// 出典表示は必須（画面側で「みんなでつくる千葉豪雨冠水道路マップ」とリンクを出す）。
// 内容は市民の投稿であり、公式に確認された通行止めではない。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SOURCE_URL = 'https://mintsuku-chiba-kansuimap.com/data/hazard_reports.json'
const SOURCE_PAGE = 'https://mintsuku-chiba-kansuimap.com/'
const CACHE_SECONDS = 600

// 印西市とその周辺（西・南・東・北）
const WEST = 140.03
const SOUTH = 35.72
const EAST = 140.34
const NORTH = 35.92

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8791',
  'http://localhost:8792',
  'http://localhost:8793',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
  }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// ---------------------------------------------------------------------------
// 運営用：いたずら・誤った投稿を CBI の地図から伏せる（2026-09-21）
// みんつく本家のデータには一切触らない。伏せた投稿の id を app_settings に持ち、
// この API が返すときに除くだけ。合言葉は通れた道 API と同じ DISASTER_MODERATION_KEY。
// ---------------------------------------------------------------------------
const HIDDEN_KEY = 'kansui_hidden_ids'

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

type HiddenEntry = { id: number; hiddenAt: string }

async function readHidden(): Promise<HiddenEntry[]> {
  const supabase = serviceClient()
  if (!supabase) return []
  const { data } = await supabase.from('app_settings').select('value').eq('key', HIDDEN_KEY).maybeSingle()
  const list = (data?.value as { ids?: HiddenEntry[] } | undefined)?.ids
  return Array.isArray(list) ? list.filter((entry) => Number.isFinite(Number(entry?.id))) : []
}

export async function DELETE(request: Request) {
  if (!isModerator(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders(request) })
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503, headers: corsHeaders(request) })
  const { searchParams } = new URL(request.url)
  const id = Number(searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'invalid_id' }, { status: 400, headers: corsHeaders(request) })
  const restore = searchParams.get('restore') === '1'
  const current = await readHidden()
  const next = restore
    ? current.filter((entry) => Number(entry.id) !== id)
    : current.some((entry) => Number(entry.id) === id) ? current : [...current, { id, hiddenAt: new Date().toISOString() }]
  const { error } = await supabase.from('app_settings').upsert({ key: HIDDEN_KEY, value: { ids: next } })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(request) })
  return NextResponse.json({ ok: true, id, hidden: !restore, hiddenCount: next.length }, { headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

type Road = { id?: number; status?: string; created_at?: string; geometry?: { type?: string; coordinates?: unknown } }

function insideInzai(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates)) return false
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length < 2) continue
    const [lon, lat] = point as [number, number]
    if (typeof lon !== 'number' || typeof lat !== 'number') continue
    if (lon >= WEST && lon <= EAST && lat >= SOUTH && lat <= NORTH) return true
  }
  return false
}

export async function GET(request: Request) {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
      // Next.js のデータキャッシュ。10分間は先方へ取りに行かない
      next: { revalidate: CACHE_SECONDS },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as { generated_at?: string; roads?: Road[] }

    const { searchParams } = new URL(request.url)
    const wantAll = searchParams.get('all') === '1' && isModerator(request)
    const hidden = await readHidden()
    const hiddenIds = new Set(hidden.map((entry) => Number(entry.id)))

    const roads = (payload.roads ?? [])
      .filter((road) => road.status !== 'pending_delete')
      .filter((road) => insideInzai(road.geometry?.coordinates))
      .filter((road) => wantAll || !hiddenIds.has(Number(road.id)))
      .map((road) => ({
        hidden: hiddenIds.has(Number(road.id)),
        id: road.id,
        createdAt: road.created_at ?? '',
        // Leaflet は [緯度, 経度] の順なので、ここで並べ替えて渡す
        path: ((road.geometry?.coordinates as [number, number][]) ?? [])
          .filter((p) => Array.isArray(p) && p.length >= 2)
          .map(([lon, lat]) => [lat, lon] as [number, number]),
      }))
      .filter((road) => road.path.length > 0)

    return NextResponse.json(
      {
        generatedAt: payload.generated_at ?? '',
        fetchedAt: new Date().toISOString(),
        count: roads.length,
        hiddenCount: hidden.length,
        roads,
        source: { name: 'みんなでつくる千葉豪雨冠水道路マップ', url: SOURCE_PAGE },
        note: '市民の投稿による情報です。公式に確認された通行止めではありません。',
      },
      { headers: { ...corsHeaders(request), 'Cache-Control': wantAll ? 'no-store' : `public, max-age=${CACHE_SECONDS}` } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/kansui]', message)
    return NextResponse.json({ error: message }, { status: 502, headers: corsHeaders(request) })
  }
}
