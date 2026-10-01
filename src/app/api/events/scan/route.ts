// チラシ画像 → Claude Vision で構造化抽出 → /events/new のフォーム自動入力に使う
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 未ログインは弾く（イベント新規登録ページ自体がログイン必須なので整合）
//
// AI 抽出はあくまで入力補助。抽出が失敗しても画像アップロードとイベント登録
// （Server Action 側）は完走できるよう、AI 系の失敗は HTTP 200 で
// { ok: false, reason } を返す（500 を投げない）。

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FLYER_ALLOWED_TYPES, extractFromFlyer, type FlyerExtractResult, type FlyerMediaType } from '@/lib/event-flyer-extract'

const MAX_BYTES = 5 * 1024 * 1024
// Anthropic の画像上限は 5MB。base64 は約1.33倍に膨らむため文字数でも判定する
const MAX_BASE64_CHARS = 5_200_000
const SCAN_MODEL = 'claude-opus-4-7'

// 画像を event-flyers バケットに保存（ベストエフォート。失敗しても null を返すだけ）
async function uploadFlyer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  buf: Buffer,
  contentType: FlyerMediaType,
): Promise<string | null> {
  const ext = ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  } as const)[contentType]
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('event-flyers')
    .upload(storagePath, buf, { contentType, cacheControl: '3600' })
  if (upErr) {
    console.warn('[events/scan] flyer upload failed:', upErr.message)
    return null
  }
  const { data: pub } = supabase.storage.from('event-flyers').getPublicUrl(storagePath)
  return pub.publicUrl
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('image')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'image (multipart File) required' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too_large', flyer_image_url: null })
  }
  if (!FLYER_ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `unsupported media type: ${file.type}` }, { status: 415 })
  }
  const mediaType = file.type as FlyerMediaType

  const buf = Buffer.from(await file.arrayBuffer())

  // 画像アップロードと AI 抽出は独立。AI が失敗してもアップロード結果は返す
  const uploadPromise = uploadFlyer(supabase, user.id, buf, mediaType)

  // skip_ai=1 のときは画像を保存するだけで AI 抽出を行わない。
  // 既に内容が入っているイベントへ後から写真だけ足す用途（編集画面）で使う。
  // AI を通すと本文や日時が上書きされてしまい、費用も無駄になるため。
  if (form.get('skip_ai') === '1') {
    return NextResponse.json({ ok: true, skipped_ai: true, flyer_image_url: await uploadPromise })
  }

  const base64 = buf.toString('base64')

  let scan: FlyerExtractResult
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[events/scan] ANTHROPIC_API_KEY not configured')
    scan = { ok: false, reason: 'config', usage: null }
  } else if (base64.length > MAX_BASE64_CHARS) {
    scan = { ok: false, reason: 'too_large', usage: null }
  } else {
    scan = await extractFromFlyer(apiKey, base64, mediaType, { model: SCAN_MODEL, logTag: 'events/scan' })
  }

  const flyer_image_url = await uploadPromise

  if (!scan.ok) {
    return NextResponse.json({ ok: false, reason: scan.reason, flyer_image_url })
  }

  return NextResponse.json({
    ok: true,
    ...scan.data,
    flyer_image_url,
    model: SCAN_MODEL,
    usage: scan.usage,
  })
}
