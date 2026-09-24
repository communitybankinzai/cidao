import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { encodeRoadImage, MAX_ROAD_IMAGE_INPUT_BYTES, ROAD_IMAGE_BUCKET } from '@/lib/disaster-road-media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173', 'http://localhost:4173',
  'http://127.0.0.1:8766', 'http://localhost:8766',
])
const MAX_BODY_BYTES = MAX_ROAD_IMAGE_INPUT_BYTES + 64 * 1024

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Access-Control-Max-Age': '86400', Vary: 'Origin', 'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

async function boundedFormData(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('image_too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_form_data')
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      // Stop reading and let the lock release; cancel() races the body stream and rejects after close.
      if (size > MAX_BODY_BYTES) throw new Error('image_too_large')
      chunks.push(Buffer.from(chunk.value))
    }
  } finally { reader.releaseLock() }
  return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData()
}

// Upload creates an unlisted URL. The edit dialog attaches it with PATCH only on Save.
// If PATCH fails the dialog retains the URL to retry without uploading another copy.
export async function POST(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  const given = request.headers.get('x-moderation-key') ?? ''
  if (!key || given.length < 16 || given !== key) return json(request, { error: 'forbidden' }, 403)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !serviceKey) return json(request, { error: 'server_not_configured' }, 503)

  let form: FormData
  try { form = await boundedFormData(request) } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'image_too_large'
    return json(request, { error: tooLarge ? 'image_too_large' : 'invalid_form_data' }, tooLarge ? 413 : 400)
  }
  const roadId = form.get('roadId')
  const image = form.get('image')
  if (typeof roadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roadId)) {
    return json(request, { error: 'invalid_id' }, 400)
  }
  if (!(image instanceof Blob) || !image.size) return json(request, { error: 'invalid_image' }, 400)
  if (image.size > MAX_ROAD_IMAGE_INPUT_BYTES) return json(request, { error: 'image_too_large' }, 413)

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: road, error: readError } = await supabase.from('disaster_passed_roads').select('id').eq('id', roadId).maybeSingle()
  if (readError) return json(request, { error: 'record_lookup_failed' }, 500)
  if (!road) return json(request, { error: 'not_found' }, 404)

  let jpeg: Buffer
  try { jpeg = await encodeRoadImage(Buffer.from(await image.arrayBuffer())) } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'image_too_large'
    return json(request, { error: tooLarge ? 'image_too_large' : 'invalid_image' }, tooLarge ? 413 : 400)
  }
  const objectPath = `${roadId}/${randomUUID()}.jpg`
  const bucket = supabase.storage.from(ROAD_IMAGE_BUCKET)
  const { error: uploadError } = await bucket.upload(objectPath, jpeg, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' })
  if (uploadError) return json(request, { error: 'image_upload_failed' }, 500)
  const { data } = bucket.getPublicUrl(objectPath)
  return json(request, { ok: true, url: data.publicUrl }, 201)
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
