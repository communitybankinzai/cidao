// 告知ページの URL → 本文取得 → Claude で要約・構造化 → /freefree/new のフォーム自動入力
//
// 画像は「候補として元サイトのURLを返すだけ」で、この時点では保存しない。
// 他人のページの画像を無自覚に転載しないよう、掲載者が権利を確認して選んだものだけを
// /api/freefree/import-image が取り込む。
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 未ログインは弾く（掲載ページ自体がログイン必須なので整合）
// 失敗は HTTP 200 で { ok:false, reason } を返す（入力補助なので手入力を妨げない）

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { parseSafeUrl, toAbsoluteSafe } from '@/lib/url-guard'
import { FREEFREE_CATEGORIES } from '@/lib/freefree-categories'

const MAX_HTML_BYTES = 3 * 1024 * 1024
const MAX_TEXT_CHARS = 60_000
const FETCH_TIMEOUT_MS = 15_000
const MAX_IMAGE_CANDIDATES = 6

type ScanFailReason = 'quota' | 'config' | 'busy' | 'fetch' | 'empty' | 'parse' | 'blocked' | 'unknown'

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const CATEGORY_KEYS = FREEFREE_CATEGORIES.map((c) => c.key)

function classify(err: unknown): ScanFailReason {
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const message = err instanceof Error ? err.message : String(err)
  console.error('[freefree/scan-url] failed:', status ?? '(no status)', message)
  if (/credit balance/i.test(message)) return 'quota'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503) return 'busy'
  if (/timeout|timed out|aborted/i.test(message)) return 'busy'
  return 'unknown'
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|dd|dt|h[1-6]|section|article|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

// og:image を最優先に、本文中の img を補う。SVG や装飾アイコンは候補から除く
function collectImages(html: string, base: URL): string[] {
  const out: string[] = []
  const push = (raw: string | undefined) => {
    if (!raw) return
    const abs = toAbsoluteSafe(raw, base)
    if (!abs) return
    if (/\.svg(\?|$)/i.test(abs)) return
    if (/(sprite|icon|logo|blank|spacer|pixel)/i.test(abs)) return
    if (!out.includes(abs)) out.push(abs)
  }

  for (const prop of ['og:image', 'twitter:image']) {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i')
    const tag = re.exec(html)?.[0]
    if (tag) push(/content=["']([^"']+)["']/i.exec(tag)?.[1])
  }

  const imgRe = /<img[^>]+>/gi
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(html)) !== null && out.length < MAX_IMAGE_CANDIDATES) {
    const tag = m[0]
    // 遅延読み込みのサイトでは src がプレースホルダなので data-src を優先する
    const lazy = /data-src=["']([^"']+)["']/i.exec(tag)?.[1]
    const plain = /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1]
    push(lazy ?? plain)
  }
  return out.slice(0, MAX_IMAGE_CANDIDATES)
}

async function fetchPage(url: URL): Promise<{ ok: true; html: string } | { ok: false; reason: ScanFailReason }> {
  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; CiDAO-FreefreeScan/1.0; +https://cidao.vercel.app)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
  } catch (err) {
    console.error('[freefree/scan-url] fetch failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'fetch' }
  }
  if (!res.ok) return { ok: false, reason: 'fetch' }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_HTML_BYTES) return { ok: false, reason: 'fetch' }
  return { ok: true, html: buf.toString('utf8') }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const url = parseSafeUrl(String(body?.url ?? ''))
  if (!url) return NextResponse.json({ ok: false, reason: 'blocked' })

  const page = await fetchPage(url)
  if (!page.ok) return NextResponse.json({ ok: false, reason: page.reason })

  const text = htmlToText(page.html).slice(0, MAX_TEXT_CHARS)
  if (text.length < 50) return NextResponse.json({ ok: false, reason: 'empty' })

  const imageCandidates = collectImages(page.html, url)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, reason: 'config', imageCandidates })

  const client = new Anthropic({ apiKey })
  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '掲載タイトル。40字以内。何をしている人・店・活動かが一読で判る短い文。' },
              body: {
                type: 'string',
                description:
                  '紹介本文。200〜400字。ページに書かれている事実（対象・料金・日時・場所・頻度・実績年数など）を拾って具体的に書く。' +
                  '書かれていないことは推測で補わない。誇張や「素晴らしい」等の評価語は使わない。',
              },
              category: { type: 'string', enum: CATEGORY_KEYS, description: '掲載カテゴリ。最も近いものを1つ。' },
              location: { ...nullableString, description: '場所・所在地。読み取れなければ null。' },
              sns_display_name: {
                ...nullableString,
                description: '店名・教室名・屋号・団体名。個人の氏名しか無い場合は必ず null。',
              },
              coupon_content: { ...nullableString, description: '特典・クーポンの記載があれば80字以内。無ければ null。' },
              links: {
                type: 'array',
                description: 'ページ内に実際に出てくる、掲載に添えると役立つリンク（申込フォーム・公式サイト・SNS・地図など）。最大4件。',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: '表示名。例: 申込フォーム / 公式サイト / Instagram' },
                    url: { type: 'string', description: '絶対URL（http/https）' },
                  },
                  required: ['label', 'url'],
                  additionalProperties: false,
                },
              },
              confidence: { type: 'number', description: '0〜1の抽出自信度' },
            },
            required: ['title', 'body', 'category', 'location', 'sns_display_name', 'coupon_content', 'links', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      system:
        '地域の掲示板に載せる「お店・教室・個人の活動」の紹介文を、告知ページの本文から起こすアシスタント。' +
        '読み取れた事実だけを使い、書かれていないことは補わない。' +
        '屋号・教室名・団体名は sns_display_name に入れるが、個人の氏名しか無い場合は null にする（本人の同意なく実名を公開しないため）。' +
        'リンクは本文中に実際に出てくるものだけを挙げ、URL を推測して作らない。' +
        'ページが告知として読み取れない場合は title="（読み取り失敗）", confidence=0 を返す。',
      messages: [
        {
          role: 'user',
          content: `次のページから、地域掲示板に載せる紹介情報を抽出してください。\n\nURL: ${url.toString()}\n\n---\n${text}`,
        },
      ],
    })
  } catch (err) {
    return NextResponse.json({ ok: false, reason: classify(err), imageCandidates })
  }

  if (response.stop_reason === 'refusal') return NextResponse.json({ ok: false, reason: 'parse', imageCandidates })
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') return NextResponse.json({ ok: false, reason: 'parse', imageCandidates })

  try {
    const parsed = JSON.parse(block.text) as Record<string, unknown>
    // AI が挙げたリンクも安全確認を通す（推測URLや危険な宛先を弾く）
    const rawLinks = Array.isArray(parsed.links) ? parsed.links : []
    const links = rawLinks
      .map((l) => l as { label?: unknown; url?: unknown })
      .map((l) => ({ label: String(l.label ?? '').slice(0, 30), url: toAbsoluteSafe(String(l.url ?? ''), url) }))
      .filter((l): l is { label: string; url: string } => !!l.label && !!l.url)
      .slice(0, 4)

    return NextResponse.json({
      ok: true,
      ...parsed,
      links,
      sourceUrl: url.toString(),
      imageCandidates,
      model: 'claude-opus-4-7',
      usage: response.usage,
    })
  } catch (err) {
    console.error('[freefree/scan-url] JSON parse failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, reason: 'parse', imageCandidates })
  }
}
