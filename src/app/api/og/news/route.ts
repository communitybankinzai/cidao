// GET /api/og/news?text=...&sig=...
// CBIサイト更新履歴の SNS 告知カード画像（JPEG・1080x1080）を動的生成する。
// cbi-admin-gas の更新履歴承認フロー（NewsPublish.gs）が Instagram 投稿の
// image_url としてこの URL を渡す（IG の Content Publishing API は JPEG の
// 公開 URL しか受け付けない）。生成パイプラインは og/proposal と同じ
// satori → resvg → sharp（next/og の ImageResponse は Windows で不具合があるため不使用）。
//
// 公開エンドポイントで任意テキストのブランド画像を作られないよう、
// text に対する HMAC-SHA256（キー: 環境変数 NEWS_OG_SECRET、GAS 側と共有）を
// sig で検証する。未設定時は 503 を返す（安全側に倒す）。

import { NextResponse } from 'next/server'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { createElement as h } from 'react'
import sharp from 'sharp'
import { createHmac, timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

const BRAND_NAVY = '#1e3a5f'
const SIZE = 1080
const MAX_TEXT = 120

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

function verifySig(text: string, sig: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(text, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(sig).toLowerCase(), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  try {
    return await render(request)
  } catch (e) {
    console.error('[og/news] failed:', e instanceof Error ? `${e.message}\n${e.stack}` : e)
    return NextResponse.json({ error: 'image generation failed' }, { status: 500 })
  }
}

async function render(request: Request) {
  const secret = process.env.NEWS_OG_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'NEWS_OG_SECRET not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const text = String(url.searchParams.get('text') || '').trim()
  const sig = String(url.searchParams.get('sig') || '')
  if (!text || text.length > MAX_TEXT) {
    return NextResponse.json({ error: 'text is required (max ' + MAX_TEXT + ' chars)' }, { status: 400 })
  }
  if (!verifySig(text, sig, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
  }

  const heading = 'CBIサイト 更新のお知らせ'
  const footer = 'communitybankinzai.github.io/cbi-site'
  const brand = 'Community Bank INZAI'

  const fontData = await loadNotoSansJP([heading, text, footer, brand].join(''))
  if (!fontData) {
    // satori はフォント必須。取得失敗時は一時エラーとして返す（GAS 側で失敗記録）
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
        {
          style: {
            fontSize: text.length > 40 ? '54px' : text.length > 24 ? '64px' : '76px',
            fontWeight: 700,
            lineHeight: 1.4,
            wordBreak: 'break-all',
          },
        },
        text,
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '30px',
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

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng()
  const jpeg = await sharp(Buffer.from(png))
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
