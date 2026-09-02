import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

// メタバース印西の「お店ピン」一覧（公開・認証不要）
// FreeFree掲示板で「メタバースに載せる」を選び、住所から緯度経度が取れた掲載のうち、
// いま掲載中（status='active' かつ期限内）のものだけを返す。掲載期間が切れると自然に消える。
// 返すのは掲載者が公開すると決めた情報（タイトル・カテゴリ・住所・リンク・店名）だけ。
// CBIメタバース（GitHub Pages）から読むため CORS を許可する。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'http://localhost:8766',
  'http://127.0.0.1:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8767',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

const CACHE_SEC = 120 // 同じ内容を何度も引かないよう、サーバー側で2分だけ保持する

type Link = { label: string; url: string }
type Shop = {
  id: string
  title: string
  shop: string | null       // 店名（団体名または掲載者が決めたSNS表示名）
  category: string
  location: string | null
  address: string | null
  lat: number
  lon: number
  links: Link[]
  expiresAt: string | null
  detailUrl: string         // CiDAO の掲載ページ
}

let cache: { at: number; body: { shops: Shop[]; fetchedAt: string } } | null = null

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=120',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request: Request) {
  if (cache && Date.now() - cache.at < CACHE_SEC * 1000) return json(request, cache.body)
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  try {
    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('freefree_posts')
      .select('id, title, category, location, address, lat, lon, links, poster_type, poster_id, sns_display_name, expires_at')
      .eq('metaverse_pin', true)
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .not('lat', 'is', null)
      .not('lon', 'is', null)
      .order('expires_at', { ascending: true })
      .limit(500)
    if (error) throw new Error(error.message)
    const rows = data ?? []

    // 団体掲載は団体名を店名にする（個人事業は掲載者が決めた表示名。個人氏名は出さない）
    const orgIds = Array.from(new Set(rows.filter((r) => r.poster_type === 'org').map((r) => r.poster_id)))
    const orgNames = new Map<string, string>()
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', orgIds)
      for (const o of orgs ?? []) orgNames.set(o.id, o.name)
    }

    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app').replace(/\/$/, '')
    const shops: Shop[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      shop: r.poster_type === 'org' ? (orgNames.get(r.poster_id) ?? null) : (r.sns_display_name ?? null),
      category: r.category,
      location: r.location ?? null,
      address: r.address ?? null,
      lat: Number(r.lat),
      lon: Number(r.lon),
      links: (Array.isArray(r.links) ? (r.links as Link[]) : [])
        .filter((l) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
        .map((l) => ({ label: String(l.label ?? '').slice(0, 30), url: l.url })),
      expiresAt: r.expires_at ?? null,
      detailUrl: `${base}/freefree/${r.id}`,
    }))
    const body = { shops, fetchedAt: nowIso }
    cache = { at: Date.now(), body }
    return json(request, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-shops GET]', message)
    // 列が未作成（migration 未適用）などでも、呼び出し側が壊れないよう空配列を返す
    return json(request, { shops: [], fetchedAt: new Date().toISOString(), error: message }, 200)
  }
}
