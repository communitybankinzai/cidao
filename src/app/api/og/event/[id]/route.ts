// GET /api/og/event/[id]
// イベント紹介の Instagram 投稿に添える画像（JPEG・1080x1350）を返す。
// チラシ画像（flyer_image_url）を、切り取らずに白地の 4:5 に収めて JPEG に変換する
// （Instagram は JPEG の公開 URL・縦横比 4:5〜1.91:1 のみ。A4 のチラシは縦長すぎて弾かれる）。
// 公開中（status=open）のイベントだけ返す。画像は自サイトのストレージのものだけ読む。

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { renderHeadlineBand, HEADLINE_BAND_H } from '@/lib/freefree-import-card'

export const runtime = 'nodejs'

const W = 1080
const H = 1350

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: ev } = await supabase
    .from('events')
    .select('title, status, flyer_image_url')
    .eq('id', id)
    .maybeSingle()
  const src = ev?.status === 'open' ? (ev.flyer_image_url as string | null) : null
  if (!src) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // 任意の URL を読ませないよう、自サイトのストレージ（公開バケット）の画像に限る
  const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/`
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !src.startsWith(storageBase)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const res = await fetch(src)
    if (!res.ok) return NextResponse.json({ error: 'image fetch failed' }, { status: 502 })
    const original = Buffer.from(await res.arrayBuffer())
    // 一覧で何の投稿か分かるよう、上に見出しの帯を付ける（フォントが取れなければ帯なしで続ける）
    const band = await renderHeadlineBand(String(ev?.title ?? '')).catch(() => null)
    const photoH = band ? H - HEADLINE_BAND_H : H
    const photo = sharp(original)
      .rotate()
      .resize(W, photoH, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
    const jpeg = band
      ? await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
          .composite([
            { input: band, top: 0, left: 0 },
            { input: await photo.png().toBuffer(), top: HEADLINE_BAND_H, left: 0 },
          ])
          .jpeg({ quality: 85 })
          .toBuffer()
      : await photo.jpeg({ quality: 85 }).toBuffer()
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
    })
  } catch (e) {
    console.error('[og/event] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'image conversion failed' }, { status: 500 })
  }
}
