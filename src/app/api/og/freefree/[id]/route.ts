// GET /api/og/freefree/[id]
// FreeFree の Instagram 投稿に添える画像（JPEG・1080x1350）を返す（2026-09-15）。
// 掲載画像は WebP で保存しているが、Instagram の Content Publishing API は JPEG の公開 URL しか受け付けず、
// 縦横比も 4:5〜1.91:1 に限られる（A4 のチラシは縦長すぎて弾かれる）。
// そこで1枚目の掲載画像を、切り取らずに白地の 4:5 に収めて JPEG に変換する。
// 掲載中（status=active）のものだけ返す。画像は自サイトのストレージのものだけ読む。

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { freefreeCategoryLabel } from '@/lib/freefree-categories'
import { areaLabelFromLocation } from '@/lib/freefree-import-core'
import { renderImportCard } from '@/lib/freefree-import-card'

export const runtime = 'nodejs'

const W = 1080
const H = 1350

// カテゴリーの色（取込掲載の画像カードで使う）
const ACCENT: Record<string, string> = {
  food: '#e8833a', retail: '#d6567a', education: '#3a7be8', craft: '#8a6d3b',
  lessons: '#c75aa8', living: '#3a9b7a', startup: '#7a5ad6', event: '#d6a21e', volunteer: '#d65a5a',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: post } = await supabase
    .from('freefree_posts')
    .select('images, status, title, category, location, lat, lon, import_source')
    .eq('id', id)
    .maybeSingle()
  const src = post?.status === 'active' ? (post.images as string[] | null)?.[0] : undefined

  // 取込掲載（OpenPOI由来）で写真が無いときは、店名・エリア・地図のカードで代用する。
  // お店の写真は無断で使わない。お店から写真が届いて images に入れば、上の写真の変換に切り替わる
  if (!src && post?.status === 'active' && (post.import_source === 'openpoi' || post.import_source === 'manual')) {
    try {
      const cat = String(post.category)
      const jpeg = await renderImportCard({
        name: String(post.title),
        categoryLabel: freefreeCategoryLabel(cat).replace(/^\S+\s/, ''), // 先頭の絵文字を除く
        accent: ACCENT[cat] ?? '#5b6b8c',
        area: areaLabelFromLocation(post.location as string | null),
        lat: typeof post.lat === 'number' ? post.lat : null,
        lon: typeof post.lon === 'number' ? post.lon : null,
      })
      if (!jpeg) return NextResponse.json({ error: 'font fetch failed' }, { status: 503 })
      return new NextResponse(new Uint8Array(jpeg), {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
      })
    } catch (e) {
      console.error('[og/freefree] import card failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'image generation failed' }, { status: 500 })
    }
  }

  if (!src) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // 任意の URL を読ませないよう、自サイトのストレージ（公開バケット）の画像に限る
  const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/`
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !src.startsWith(storageBase)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const res = await fetch(src)
    if (!res.ok) return NextResponse.json({ error: 'image fetch failed' }, { status: 502 })
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .rotate() // 写真の向き情報に合わせる
      .resize(W, H, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' }) // 透過部分を白に（JPEG は透過を持てない）
      .jpeg({ quality: 85 })
      .toBuffer()
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
    })
  } catch (e) {
    console.error('[og/freefree] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'image conversion failed' }, { status: 500 })
  }
}
