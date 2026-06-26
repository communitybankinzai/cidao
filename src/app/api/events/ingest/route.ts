// 外部システム（COCoLa Apps Script の画像スキャン等）から CiDAO にイベントを取り込む受け口。
//
// 認証: 共有シークレット（x-ingest-secret ヘッダー）。
//   - 既存の Supabase 認証は無関係。COCoLa 側が Apps Script から POST するため。
//   - シークレットは Vercel の環境変数 INGEST_SHARED_SECRET に格納。
//
// 必須 env:
//   - INGEST_SHARED_SECRET            : 共有シークレット（POST 側と一致させる）
//   - SUPABASE_SERVICE_ROLE_KEY       : RLS を bypass して events insert するため
//   - NEXT_PUBLIC_SUPABASE_URL        : Supabase URL
//   - INGEST_BOT_MEMBER_ID            : 取り込みイベントの organizer_id（CiDAO の bot アカウント member id）
//
// dedupe: (external_source, external_source_id) で既存チェック。重複時は既存 event_id を返すのみ。

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { jstLocalToUtcIso } from '@/lib/datetime'

type IngestPayload = {
  source_id: string            // 外部側の一意 ID（COCoLa の Drive file id 等）
  source_url?: string          // 外部側の参照 URL（Drive ファイル URL 等）
  title: string
  description?: string
  start_at: string             // YYYY-MM-DDTHH:MM（JST ローカル想定）
  end_at?: string              // YYYY-MM-DDTHH:MM。省略時は start_at + 1h
  location?: string
  organizer_name?: string      // 主催団体名（proxy_registration として保存）
  category?: string            // 既定 'other'
  image_base64?: string
  image_mime?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
}

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  // 1. 認証
  const provided = request.headers.get('x-ingest-secret') ?? ''
  const expected = process.env.INGEST_SHARED_SECRET ?? ''
  if (!expected) {
    return NextResponse.json({ error: 'INGEST_SHARED_SECRET not configured' }, { status: 503 })
  }
  if (!timingSafeEq(provided, expected)) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 })
  }

  // 2. env チェック
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const botMemberId = process.env.INGEST_BOT_MEMBER_ID ?? ''
  if (!url || !serviceKey || !botMemberId) {
    return NextResponse.json({ error: 'ingest env not fully configured' }, { status: 503 })
  }

  // 3. payload 解析
  let body: IngestPayload
  try {
    body = (await request.json()) as IngestPayload
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.source_id || !body.title || !body.start_at) {
    return NextResponse.json({ error: 'source_id, title, start_at required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.start_at)) {
    return NextResponse.json({ error: 'start_at must be YYYY-MM-DDTHH:MM' }, { status: 400 })
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 4. dedupe
  const externalSource = 'cocola-image-scan'
  const { data: existing } = await supabase
    .from('events')
    .select('id, flyer_image_url')
    .eq('external_source', externalSource)
    .eq('external_source_id', body.source_id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({
      event_id: existing.id,
      flyer_image_url: existing.flyer_image_url,
      deduped: true,
    })
  }

  // 5. 画像アップロード（best-effort）
  let flyer_image_url: string | null = null
  if (body.image_base64 && body.image_mime && MIME_TO_EXT[body.image_mime]) {
    try {
      const buf = Buffer.from(body.image_base64, 'base64')
      if (buf.length > 0 && buf.length <= MAX_IMAGE_BYTES) {
        const ext = MIME_TO_EXT[body.image_mime]
        const safeId = body.source_id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
        const path = `cocola-ingest/${safeId}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('event-flyers')
          .upload(path, buf, {
            contentType: body.image_mime,
            upsert: true,
            cacheControl: '3600',
          })
        if (upErr) {
          console.warn('[events/ingest] flyer upload failed:', upErr.message)
        } else {
          const { data: pub } = supabase.storage.from('event-flyers').getPublicUrl(path)
          flyer_image_url = pub.publicUrl
        }
      }
    } catch (e) {
      console.warn('[events/ingest] image decode failed:', (e as Error).message)
    }
  }

  // 6. events insert
  const isProxy = !!body.organizer_name
  const end_at = body.end_at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.end_at)
    ? body.end_at
    : plusOneHourLocal(body.start_at)

  const { data: inserted, error: insErr } = await supabase
    .from('events')
    .insert({
      title: body.title.slice(0, 80),
      description: (body.description ?? body.title).slice(0, 4000),
      category: body.category ?? 'other',
      start_at: jstLocalToUtcIso(body.start_at),
      end_at: jstLocalToUtcIso(end_at),
      location: body.location ?? null,
      online_flag: false,
      organizer_type: 'member',
      organizer_id: botMemberId,
      organizer_name_text: isProxy ? (body.organizer_name as string) : null,
      proxy_registration: isProxy,
      proxy_source_url: isProxy ? (body.source_url ?? 'https://cocola/image-scan') : null,
      external_source: externalSource,
      external_source_id: body.source_id,
      flyer_image_url,
      status: 'open',
    })
    .select('id')
    .single()

  if (insErr) {
    return NextResponse.json({ error: `insert failed: ${insErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    event_id: inserted.id,
    flyer_image_url,
    deduped: false,
  })
}

function timingSafeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// "YYYY-MM-DDTHH:MM" → +1時間（同日内で wrap、24時超は 23:59 にクランプ）
function plusOneHourLocal(s: string): string {
  const [date, time] = s.split('T')
  const [hhStr, mm] = time.split(':')
  const h = parseInt(hhStr, 10) + 1
  if (h < 24) return `${date}T${String(h).padStart(2, '0')}:${mm}`
  return `${date}T23:59`
}
