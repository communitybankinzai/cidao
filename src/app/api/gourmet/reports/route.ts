// 食レポ飲食店マップ（CBIサイト site/gourmet-map）の API。
// GET   : 市民が足したお店と、食レポ（SNS の URL）の一覧。?all=1＋合言葉で伏せた分も
// POST  : 食レポを1件登録（multipart）。お店は shopRef か、新しいお店（newShopName・newShopLat・newShopLon・newShopAddress）
//         写真（image）は「自分の投稿です」（isOwn=1）のときだけ1枚。JPEG に作り直して位置情報を落とす
// DELETE: 自分の食レポの取り消し（同じ端末ID・送信から30分以内。行は消さず hidden=true）
// PATCH : 運営が伏せる／戻す（?id=&type=report|shop・合言葉）
// 匿名・すぐ公開・運営が伏せる（2026-11-06 事業主決定・防災MAPの通れた道と同じ運用）。

import { createHash, randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { memoTtl } from '@/lib/memo-ttl'
import { encodeRoadImage, MAX_ROAD_IMAGE_INPUT_BYTES } from '@/lib/disaster-road-media'
import {
  MAX_ADDRESS, MAX_COMMENT, MAX_SHOP_NAME, insideGourmetArea, normalizeHandle, normalizeText,
  parseShopRef, parseSnsUrl, roundCoord,
} from '@/lib/gourmet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173', 'http://localhost:4173',
  'http://127.0.0.1:8766', 'http://localhost:8766',
  'http://127.0.0.1:8767', 'http://localhost:8767',
])
const IMAGE_BUCKET = 'gourmet-images'
const MAX_BODY_BYTES = MAX_ROAD_IMAGE_INPUT_BYTES + 64 * 1024
const MIN_INTERVAL_SECONDS = 30 // 同じ端末・同じ発信元からの連続登録の間隔
const UNDO_WINDOW_SECONDS = 1800 // 自分の食レポを取り消せる時間
const SAME_SHOP_M = 100 // 市民が足すお店：同じ名前でこの距離以内なら既にあるお店を使う
const LIST_LIMIT = 3000
const MIGRATION_HINT = 'gourmet tables not found. Run migration 20261106200000_gourmet_reports.sql.'
// OpenStreetMap のお店の一覧（site/gourmet-map/pipeline/build_shops.py が作る）。お店の名前と位置はここから取る
const OSM_SHOPS_URL = 'https://communitybankinzai.github.io/cbi-site/gourmet-map/osm-shops.json'

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200, cache = 'no-store') {
  return NextResponse.json(body, { status, headers: { ...corsHeaders(request), 'Cache-Control': cache } })
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
type Db = NonNullable<ReturnType<typeof serviceClient>>

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST200') return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(error.message ?? '')
}

// 防災MAPと同じ合言葉（DISASTER_MODERATION_KEY、無ければ CRON_SECRET）
function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  if (!key) return false
  const given = request.headers.get('x-moderation-key') ?? ''
  return given.length >= 16 && given === key
}

function ipHash(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || ''
  if (!ip) return ''
  return createHash('sha256').update(`gourmet:${ip}`).digest('hex').slice(0, 32)
}

function validDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v)
}

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 6371008.8
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLon = (bLon - aLon) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(s))
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram', threads: 'Threads', x: 'X', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook',
  bluesky: 'Bluesky', lemon8: 'Lemon8', note: 'note', ameblo: 'アメブロ', hatena: 'はてなブログ',
}

type ReportRow = {
  id: string; shop_ref: string; shop_name: string; lat: number; lon: number; url: string; platform: string
  author_handle: string | null; is_own: boolean; image_url: string | null; comment: string | null
  hidden: boolean; created_at: string
}
type ShopRow = { id: string; name: string; address: string | null; lat: number; lon: number; hidden: boolean; created_at: string }

function reportOut(r: ReportRow, withHidden: boolean) {
  return {
    id: r.id, shopRef: r.shop_ref, shopName: r.shop_name, lat: r.lat, lon: r.lon, url: r.url,
    platform: r.platform, platformLabel: PLATFORM_LABELS[r.platform] ?? r.platform, handle: r.author_handle,
    isOwn: r.is_own, imageUrl: r.image_url, comment: r.comment, createdAt: r.created_at,
    ...(withHidden ? { hidden: r.hidden } : {}),
  }
}
function shopOut(s: ShopRow, withHidden: boolean) {
  return {
    ref: `shop:${s.id}`, name: s.name, address: s.address, lat: s.lat, lon: s.lon, createdAt: s.created_at,
    ...(withHidden ? { hidden: s.hidden } : {}),
  }
}

async function readAll(supabase: Db, withHidden: boolean) {
  let shopQ = supabase.from('gourmet_shops').select('id, name, address, lat, lon, hidden, created_at')
    .order('created_at', { ascending: false }).limit(LIST_LIMIT)
  let repQ = supabase.from('gourmet_reports')
    .select('id, shop_ref, shop_name, lat, lon, url, platform, author_handle, is_own, image_url, comment, hidden, created_at')
    .order('created_at', { ascending: false }).limit(LIST_LIMIT)
  if (!withHidden) { shopQ = shopQ.eq('hidden', false); repQ = repQ.eq('hidden', false) }
  const [shops, reports] = await Promise.all([shopQ, repQ])
  if (shops.error) throw shops.error
  if (reports.error) throw reports.error
  return {
    shops: (shops.data as ShopRow[]).map((s) => shopOut(s, withHidden)),
    reports: (reports.data as ReportRow[]).map((r) => reportOut(r, withHidden)),
  }
}

export async function GET(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const all = new URL(request.url).searchParams.get('all') === '1'
  if (all && !isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  try {
    const body = all ? await readAll(supabase, true) : await memoTtl('gourmet:list', 60_000, () => readAll(supabase, false))
    return json(request, { ok: true, ...body }, 200, all ? 'no-store' : 'public, max-age=30, s-maxage=60')
  } catch (error) {
    const e = error as { code?: string; message?: string }
    if (isMissingTable(e)) return json(request, { error: 'not_ready', hint: MIGRATION_HINT }, 503)
    console.error('[gourmet GET]', e.message)
    return json(request, { error: 'read_failed' }, 500)
  }
}

// OpenStreetMap のお店の一覧（id → 名前・位置）。読めないときは null（そのときは画面から来た名前と位置を範囲内なら使う）
async function osmShops(): Promise<Map<string, { name: string; lat: number; lon: number }> | null> {
  try {
    return await memoTtl('gourmet:osm', 6 * 3600_000, async () => {
      // Next のデータキャッシュは 404 も保存してしまう（公開前の 404 が1日残った）ので使わない。使い回しは memoTtl の6時間だけ
      const res = await fetch(OSM_SHOPS_URL, { cache: 'no-store' })
      if (!res.ok) throw new Error(`osm-shops ${res.status}`)
      const data = (await res.json()) as { shops?: Array<{ id: string; name: string; lat: number; lon: number }> }
      const map = new Map<string, { name: string; lat: number; lon: number }>()
      for (const s of data.shops ?? []) map.set(String(s.id).toLowerCase(), { name: s.name, lat: s.lat, lon: s.lon })
      if (map.size === 0) throw new Error('osm-shops empty')
      return map
    })
  } catch (error) {
    console.warn('[gourmet] osm-shops を読めません', (error as Error).message)
    return null
  }
}

async function boundedFormData(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_form_data')
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) throw new Error('too_large')
      chunks.push(Buffer.from(chunk.value))
    }
  } finally { reader.releaseLock() }
  return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData()
}

function field(form: FormData, name: string): string | undefined {
  const v = form.get(name)
  return typeof v === 'string' ? v : undefined
}

export async function POST(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  let form: FormData
  try { form = await boundedFormData(request) } catch (error) {
    const tooLarge = (error as Error).message === 'too_large'
    return json(request, { error: tooLarge ? 'image_too_large' : 'invalid_form_data' }, tooLarge ? 413 : 400)
  }

  const deviceId = field(form, 'deviceId')
  if (!validDeviceId(deviceId)) return json(request, { error: 'invalid_device' }, 400)
  const sns = parseSnsUrl(field(form, 'url'))
  if (!sns) return json(request, { error: 'invalid_url' }, 400)
  const isOwn = field(form, 'isOwn') === '1'
  const handle = normalizeHandle(field(form, 'handle'))
  if (handle === undefined) return json(request, { error: 'invalid_handle' }, 400)
  const comment = normalizeText(field(form, 'comment'), MAX_COMMENT)
  if (comment === undefined) return json(request, { error: 'invalid_comment' }, 400)
  const image = form.get('image')
  const hasImage = image instanceof Blob && image.size > 0
  if (hasImage && !isOwn) return json(request, { error: 'image_requires_own' }, 400)
  if (hasImage && (image as Blob).size > MAX_ROAD_IMAGE_INPUT_BYTES) return json(request, { error: 'image_too_large' }, 413)

  const hash = ipHash(request)
  const moderator = isModerator(request)
  const now = Date.now()

  // 連続登録の間隔（運営の合言葉つきは見ない）
  if (!moderator) {
    const since = new Date(now - MIN_INTERVAL_SECONDS * 1000).toISOString()
    const filter = hash ? `device_id.eq.${deviceId},ip_hash.eq.${hash}` : `device_id.eq.${deviceId}`
    const { data: recent, error } = await supabase.from('gourmet_reports').select('created_at')
      .or(filter).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
    if (error) {
      if (isMissingTable(error)) return json(request, { error: 'not_ready', hint: MIGRATION_HINT }, 503)
      return json(request, { error: 'read_failed' }, 500)
    }
    if (recent && recent.length > 0) {
      const latestAt = Date.parse(String(recent[0].created_at))
      const retryAfterSeconds = Number.isFinite(latestAt)
        ? Math.max(1, Math.min(MIN_INTERVAL_SECONDS, Math.ceil((latestAt + MIN_INTERVAL_SECONDS * 1000 - now) / 1000)))
        : MIN_INTERVAL_SECONDS
      return json(request, { error: 'too_frequent', retryAfterSeconds }, 429)
    }
  }

  // お店を決める
  let shop: { ref: string; name: string; lat: number; lon: number } | null = null
  let newShopRow: ShopRow | null = null
  const ref = parseShopRef(field(form, 'shopRef'))
  if (ref?.kind === 'osm') {
    const map = await osmShops()
    const hit = map?.get(ref.id)
    if (map && !hit) return json(request, { error: 'unknown_shop' }, 400)
    if (hit) shop = { ref: ref.ref, name: hit.name, lat: hit.lat, lon: hit.lon }
    else {
      // 一覧を読めないときだけ、画面から来た名前と位置を使う（範囲の中に限る）
      const name = normalizeText(field(form, 'shopName'), MAX_SHOP_NAME)
      const lat = Number(field(form, 'shopLat'))
      const lon = Number(field(form, 'shopLon'))
      if (!name || !insideGourmetArea(lat, lon)) return json(request, { error: 'unknown_shop' }, 400)
      shop = { ref: ref.ref, name, lat: roundCoord(lat), lon: roundCoord(lon) }
    }
  } else if (ref?.kind === 'shop') {
    const { data, error } = await supabase.from('gourmet_shops').select('id, name, lat, lon, hidden').eq('id', ref.id).maybeSingle()
    if (error) return json(request, { error: isMissingTable(error) ? 'not_ready' : 'read_failed' }, isMissingTable(error) ? 503 : 500)
    if (!data || data.hidden) return json(request, { error: 'unknown_shop' }, 400)
    shop = { ref: ref.ref, name: data.name, lat: data.lat, lon: data.lon }
  } else if (ref?.kind === 'ff') {
    const { data, error } = await supabase.from('freefree_posts').select('id, title, lat, lon, status, category')
      .eq('id', ref.id).maybeSingle()
    if (error) return json(request, { error: 'read_failed' }, 500)
    if (!data || data.status !== 'active' || typeof data.lat !== 'number' || typeof data.lon !== 'number') {
      return json(request, { error: 'unknown_shop' }, 400)
    }
    const name = normalizeText(field(form, 'shopName'), MAX_SHOP_NAME) || normalizeText(data.title, MAX_SHOP_NAME) || 'FreeFreeの掲載'
    shop = { ref: ref.ref, name, lat: data.lat, lon: data.lon }
  } else if (field(form, 'shopRef')) {
    return json(request, { error: 'unknown_shop' }, 400)
  } else {
    // 新しいお店
    const name = normalizeText(field(form, 'newShopName'), MAX_SHOP_NAME)
    const address = normalizeText(field(form, 'newShopAddress'), MAX_ADDRESS)
    const lat = Number(field(form, 'newShopLat'))
    const lon = Number(field(form, 'newShopLon'))
    if (!name || address === undefined) return json(request, { error: 'invalid_shop' }, 400)
    if (!insideGourmetArea(lat, lon)) return json(request, { error: 'outside_area' }, 400)
    // 同じ名前・近い位置のお店がもうあれば、それに付ける（二重登録を防ぐ）
    const { data: same, error } = await supabase.from('gourmet_shops').select('id, name, lat, lon, hidden')
      .eq('name', name).eq('hidden', false).limit(20)
    if (error) return json(request, { error: isMissingTable(error) ? 'not_ready' : 'read_failed' }, isMissingTable(error) ? 503 : 500)
    const near = (same ?? []).find((s) => distanceM(s.lat, s.lon, lat, lon) <= SAME_SHOP_M)
    if (near) shop = { ref: `shop:${near.id}`, name: near.name, lat: near.lat, lon: near.lon }
    else {
      const { data: inserted, error: insErr } = await supabase.from('gourmet_shops')
        .insert({ name, address, lat: roundCoord(lat), lon: roundCoord(lon), device_id: deviceId, ip_hash: hash })
        .select('id, name, address, lat, lon, hidden, created_at').single()
      if (insErr || !inserted) return json(request, { error: 'shop_insert_failed' }, 500)
      newShopRow = inserted as ShopRow
      shop = { ref: `shop:${inserted.id}`, name: inserted.name, lat: inserted.lat, lon: inserted.lon }
    }
  }
  if (!shop) return json(request, { error: 'unknown_shop' }, 400)

  // 同じお店に同じ投稿は1回だけ
  const { data: dup } = await supabase.from('gourmet_reports').select('id').eq('shop_ref', shop.ref).eq('url', sns.url).limit(1)
  if (dup && dup.length > 0) return json(request, { error: 'duplicate' }, 409)

  // 写真（自分の投稿のときだけ）
  const id = randomUUID()
  let imageUrl: string | null = null
  let objectPath: string | null = null
  if (hasImage) {
    let jpeg: Buffer
    try { jpeg = await encodeRoadImage(Buffer.from(await (image as Blob).arrayBuffer())) } catch (error) {
      const tooLarge = (error as Error).message === 'image_too_large'
      return json(request, { error: tooLarge ? 'image_too_large' : 'invalid_image' }, tooLarge ? 413 : 400)
    }
    objectPath = `${id}.jpg`
    const bucket = supabase.storage.from(IMAGE_BUCKET)
    const { error: upErr } = await bucket.upload(objectPath, jpeg, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' })
    if (upErr) return json(request, { error: 'image_upload_failed' }, 500)
    imageUrl = bucket.getPublicUrl(objectPath).data.publicUrl
  }

  const row = {
    id, shop_ref: shop.ref, shop_name: shop.name, lat: shop.lat, lon: shop.lon, url: sns.url, platform: sns.platform,
    author_handle: handle ?? sns.handle, is_own: isOwn, image_url: imageUrl, comment, device_id: deviceId, ip_hash: hash,
  }
  const { error: insErr } = await supabase.from('gourmet_reports').insert(row)
  if (insErr) {
    if (objectPath) await supabase.storage.from(IMAGE_BUCKET).remove([objectPath])
    if (insErr.code === '23505') return json(request, { error: 'duplicate' }, 409)
    console.error('[gourmet POST]', insErr.message)
    return json(request, { error: 'insert_failed' }, 500)
  }
  return json(request, {
    ok: true,
    report: reportOut({ ...row, hidden: false, created_at: new Date().toISOString() } as ReportRow, false),
    shop: newShopRow ? shopOut(newShopRow, false) : null,
    undoSeconds: UNDO_WINDOW_SECONDS,
  }, 201)
}

export async function DELETE(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const params = new URL(request.url).searchParams
  const id = params.get('id') ?? ''
  const deviceId = params.get('deviceId')
  if (!/^[0-9a-f-]{36}$/i.test(id) || !validDeviceId(deviceId)) return json(request, { error: 'invalid_request' }, 400)
  const { data, error } = await supabase.from('gourmet_reports').select('id, device_id, created_at, hidden').eq('id', id).maybeSingle()
  if (error) return json(request, { error: 'read_failed' }, 500)
  if (!data || data.device_id !== deviceId) return json(request, { error: 'not_found' }, 404)
  if (Date.now() - Date.parse(String(data.created_at)) > UNDO_WINDOW_SECONDS * 1000) return json(request, { error: 'too_late' }, 409)
  const { error: upErr } = await supabase.from('gourmet_reports').update({ hidden: true }).eq('id', id).eq('device_id', deviceId)
  if (upErr) return json(request, { error: 'update_failed' }, 500)
  return json(request, { ok: true })
}

export async function PATCH(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const params = new URL(request.url).searchParams
  const id = params.get('id') ?? ''
  const table = params.get('type') === 'shop' ? 'gourmet_shops' : 'gourmet_reports'
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, { error: 'invalid_id' }, 400)
  let body: { hidden?: unknown }
  try { body = await request.json() } catch { return json(request, { error: 'invalid_json' }, 400) }
  if (typeof body.hidden !== 'boolean') return json(request, { error: 'invalid_hidden' }, 400)
  const { data, error } = await supabase.from(table).update({ hidden: body.hidden }).eq('id', id).select('id')
  if (error) return json(request, { error: 'update_failed' }, 500)
  if (!data || data.length === 0) return json(request, { error: 'not_found' }, 404)
  return json(request, { ok: true })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } })
}
