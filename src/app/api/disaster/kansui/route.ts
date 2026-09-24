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
import { isOnLand } from '@/lib/land-mask-chiba'

const SOURCE_URL = 'https://mintsuku-chiba-kansuimap.com/data/hazard_reports.json'
const SOURCE_PAGE = 'https://mintsuku-chiba-kansuimap.com/'
const CACHE_SECONDS = 600

// 千葉県全域を囲む四角（2026-09-22 に印西市周辺から拡大）
const WEST = 139.70
const SOUTH = 34.85
const EAST = 140.90
const NORTH = 36.15

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
  // 伏せた一覧は毎回読み直す。Next.js が fetch の結果を保存するため、指定しないと古い一覧のまま配信され続けた
  // （2026-09-22：朝に伏せた3件が一般向けの配信から消えなかった）
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
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

// 範囲の四角の中で、しかも陸地にある点を1つでも含む投稿だけ残す（海の上の誤投稿を除く・2026-09-22）
function insideArea(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates)) return false
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length < 2) continue
    const [lon, lat] = point as [number, number]
    if (typeof lon !== 'number' || typeof lat !== 'number') continue
    if (lon >= WEST && lon <= EAST && lat >= SOUTH && lat <= NORTH && isOnLand(lat, lon)) return true
  }
  return false
}

export async function GET(request: Request) {
  try {
    // ⚠ next.revalidate だけに任せると、いちど保存した中身が居座り続けることがある。
    // 2026-09-24 に実際に起きた：本番が 9/21 07:20 生成のまま3日間止まり、台風25号の後半の
    // 2,651件が地図に出ていなかった（本家は 9/24 08:30 生成・9,312件）。
    // そこで URL の末尾に「10分ごとに変わる印」を付け、保存の鍵そのものを入れ替える。
    // 先方へ取りに行く回数は従来どおり10分に1回のまま（規約の「大量リクエスト」に当たらない）。
    const bucket = Math.floor(Date.now() / (CACHE_SECONDS * 1000))
    const response = await fetch(`${SOURCE_URL}?cbi=${bucket}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
      // 10分間は先方へ取りに行かない（鍵が変わるまでは保存した中身を使う）
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
      .filter((road) => insideArea(road.geometry?.coordinates))
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
        // 本家が作ってから何分たっているか。大きいままなら取り込みが止まっている（2026-09-24 追加）
        generatedAgeMinutes: payload.generated_at
          ? Math.round((Date.now() - new Date(payload.generated_at).getTime()) / 60000)
          : null,
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
