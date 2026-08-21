// GET /api/og/proposal/[id]
// 提案の SNS 告知カード画像（JPEG・1080x1080）を動的生成する。
// Instagram の Content Publishing API は JPEG の公開 URL しか受け付けないため、
// satori（レイアウト→SVG、テキストはパス化されるため描画環境のフォント不要）
// → sharp（SVG→JPEG）で変換して返す。
// ※ next/og の ImageResponse は同梱 sharp の不具合で Windows 環境で
//   「colourspace: parameter space not set」を出すため使わない（2026-08-06 実測）。
//
// 日本語フォントは Google Fonts の css2 API からタイトル文字だけの
// サブセットを実行時に取得する（satori は woff2 非対応のため ttf/otf を抽出）。

import { NextResponse } from 'next/server'
import satori from 'satori'
import { createElement as h } from 'react'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { categoryLabel } from '@/lib/categories'

export const runtime = 'nodejs'

const BRAND_NAVY = '#1e3a5f'
const SIZE = 1080

async function loadNotoSansJP(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`
    // UA を指定しない fetch には ttf/otf 形式の URL が返る（woff2 だと satori が読めない）
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
    console.error('[og/proposal] failed:', msg)
    // ?debug=1 のときだけエラー内容を返す（本番での原因調査用。個人情報は含まれない）
    const debug = new URL(request.url).searchParams.get('debug') === '1'
    return NextResponse.json(
      { error: 'image generation failed', ...(debug ? { detail: msg.slice(0, 600) } : {}) },
      { status: 500 },
    )
  }
}

async function render(params: Promise<{ id: string }>) {
  const { id } = await params
  const supabase = await createClient()
  const { data: proposal } = await supabase
    .from('proposals')
    .select('title, category, status')
    .eq('id', id)
    .maybeSingle()
  if (!proposal || !['discussion', 'voting'].includes(String(proposal.status))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const title = String(proposal.title)
  const category = categoryLabel(String(proposal.category))
  const heading = 'CiDAOに新しい提案'
  const footer = '意見・投票で参加できます（登録無料）'
  const brand = 'CiDAO - 印西の市民DAO'

  const fontData = await loadNotoSansJP([heading, title, category, footer, brand].join(''))
  if (!fontData) {
    // satori はフォント必須。取得失敗時は一時エラーとして返す（dispatch 側で failed 記録）
    return NextResponse.json({ error: 'font fetch failed' }, { status: 503 })
  }

  const svg = await satori(
    h(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: BRAND_NAVY,
          color: '#ffffff',
          padding: '72px',
          fontFamily: 'NotoSansJP',
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '20px' } },
        h('div', {
          style: {
            width: '20px',
            height: '56px',
            backgroundColor: '#f0c040',
            borderRadius: '4px',
          },
        }),
        h('div', { style: { fontSize: '44px', opacity: 0.95 } }, heading),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '32px' } },
        h(
          'div',
          {
            style: {
              fontSize: title.length > 24 ? '64px' : '76px',
              fontWeight: 700,
              lineHeight: 1.35,
              wordBreak: 'break-all',
            },
          },
          title,
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignSelf: 'flex-start',
              fontSize: '34px',
              backgroundColor: 'rgba(255,255,255,0.16)',
              borderRadius: '9999px',
              padding: '10px 32px',
            },
          },
          category,
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '32px',
            opacity: 0.9,
          },
        },
        h('div', null, footer),
        h('div', { style: { fontWeight: 700 } }, brand),
      ),
    ),
    {
      width: SIZE,
      height: SIZE,
      fonts: [{ name: 'NotoSansJP', data: fontData, weight: 700 as const, style: 'normal' as const }],
    },
  )

  // satori の SVG はテキストがパス化済みなので、sharp（libvips の SVG ローダー）で
  // 直接 JPEG 化できる。以前は @resvg/resvg-js で PNG 化を挟んでいたが、
  // 本番（Vercel Linux）でネイティブバイナリのロードに失敗し全カードが 500 になったため
  // 依存を sharp に一本化した（2026-08-21）
  const jpeg = await sharp(Buffer.from(svg))
    .jpeg({ quality: 88 })
    .toBuffer()

  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      // Instagram が取得しに来る一時的な URL。1時間キャッシュで十分
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
