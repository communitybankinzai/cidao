// GET /api/og/gourmet/[id]
// 食レポマップの SNS 紹介カード画像（JPEG・1080x1080・2026-11-12）。Instagram は画像が必須のため。
// 作り方は /api/og/proposal/[id] と同じ（satori → sharp）。
// 載せるのは店名・SNS の種類・（自分の投稿で同意があれば）@名前だけ。投稿の写真は転載しない。
// 伏せた・取り消した・紹介に同意していない食レポは 404。

import { NextResponse } from 'next/server'
import { createElement as h } from 'react'
import { fetchGourmetReportForSns, gourmetSnsTarget } from '@/lib/sns-target'

export const runtime = 'nodejs'

const BRAND_NAVY = '#1e3a5f'
const ACCENT = '#d9480f'
const SIZE = 1080

async function loadNotoSansJP(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`
    const css = await (await fetch(cssUrl)).text()
    const m = css.match(/src:\s*url\((https:[^)]+)\)\s*format\('(?:opentype|truetype)'\)/)
    if (!m) return null
    return await (await fetch(m[1])).arrayBuffer()
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await render(params)
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
    console.error('[og/gourmet] failed:', msg)
    const debug = new URL(request.url).searchParams.get('debug') === '1'
    return NextResponse.json(
      { error: 'image generation failed', ...(debug ? { detail: msg.slice(0, 600) } : {}) },
      { status: 500 },
    )
  }
}

async function render(params: Promise<{ id: string }>) {
  const { id } = await params
  const report = await fetchGourmetReportForSns(id)
  if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const t = gourmetSnsTarget(report)

  const shop = t.title.length > 40 ? `${t.title.slice(0, 39)}…` : t.title
  const heading = '新しい食レポが届きました'
  const who = t.gourmet_handle ? `@${t.gourmet_handle.replace(/^@/, '')} さんの${t.gourmet_platform}の投稿` : `${t.gourmet_platform}の投稿`
  const footer = 'くわしくは元の投稿へ'
  const brand = '印西 食レポマップ'
  const credit = 'CBI（Community Bank INZAI）の試作'

  const fontData = await loadNotoSansJP([heading, shop, who, footer, brand, credit, '🍽'].join(''))
  if (!fontData) return NextResponse.json({ error: 'font fetch failed' }, { status: 503 })

  const satori = (await import('satori')).default
  const sharp = (await import('sharp')).default

  const svg = await satori(
    h(
      'div',
      {
        style: {
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          backgroundColor: BRAND_NAVY, color: '#ffffff', padding: '72px', fontFamily: 'NotoSansJP',
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '20px' } },
        h('div', { style: { display: 'flex', fontSize: '36px', backgroundColor: ACCENT, borderRadius: '9999px', padding: '10px 36px' } }, brand),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '36px' } },
        h('div', { style: { fontSize: '46px', color: '#f0c040' } }, heading),
        h(
          'div',
          { style: { fontSize: shop.length > 16 ? '68px' : '84px', fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-all' } },
          shop,
        ),
        h(
          'div',
          { style: { display: 'flex', alignSelf: 'flex-start', fontSize: '34px', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: '9999px', padding: '10px 32px' } },
          who,
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '30px', opacity: 0.9 } },
        h('div', null, footer),
        h('div', { style: { fontSize: '26px' } }, credit),
      ),
    ),
    {
      width: SIZE,
      height: SIZE,
      fonts: [{ name: 'NotoSansJP', data: fontData, weight: 700 as const, style: 'normal' as const }],
    },
  )

  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()
  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  })
}
