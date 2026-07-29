// チラシ・店頭写真 → Claude Vision で構造化抽出 → /freefree/new のフォーム自動入力に使う
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 未ログインは弾く（FreeFree 新規掲載ページ自体がログイン必須なので整合）
//
// AI 抽出はあくまで入力補助。抽出が失敗しても画像アップロードと掲載登録
// （Server Action 側）は完走できるよう、AI 系の失敗は HTTP 200 で
// { ok: false, reason } を返す（500 を投げない）。
//
// 注: /api/events/scan と構造がよく似ているが、抽出したい項目（日時が要る／要らない、
// カテゴリの語彙）が別物なので独立させている。共通化は両者の仕様が揃ってから。

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { FREEFREE_CATEGORIES } from '@/lib/freefree-categories'

const MAX_BYTES = 5 * 1024 * 1024
// Anthropic の画像上限は 5MB。base64 は約1.33倍に膨らむため文字数でも判定する
const MAX_BASE64_CHARS = 5_200_000
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

// quota: クレジット不足・レート制限 / config: キー不正 / busy: 過負荷・タイムアウト
// too_large: 画像が Anthropic 上限超え / parse: 応答が解釈できない / unknown: その他
type ScanFailReason = 'quota' | 'config' | 'busy' | 'too_large' | 'parse' | 'unknown'

type ScanResult =
  | { ok: true; data: Record<string, unknown>; usage: unknown }
  | { ok: false; reason: ScanFailReason }

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const CATEGORY_KEYS = FREEFREE_CATEGORIES.map((c) => c.key)

function classifyScanError(err: unknown): ScanFailReason {
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const message = err instanceof Error ? err.message : String(err)
  console.error('[freefree/scan] AI extraction failed:', status ?? '(no status)', message)
  if (/credit balance/i.test(message)) return 'quota'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503) return 'busy'
  if (/timeout|timed out|aborted/i.test(message)) return 'busy'
  return 'unknown'
}

// 画像を freefree-images バケットに保存（ベストエフォート。失敗しても null を返すだけ）
// パスは掲載フォームのクライアント側アップロードと同じ pending/<userId>/ 配下に揃える。
async function uploadImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  buf: Buffer,
  contentType: MediaType,
): Promise<string | null> {
  const ext = ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  } as const)[contentType]
  const storagePath = `pending/${userId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('freefree-images')
    .upload(storagePath, buf, { contentType, cacheControl: '300' })
  if (upErr) {
    console.warn('[freefree/scan] image upload failed:', upErr.message)
    return null
  }
  const { data: pub } = supabase.storage.from('freefree-images').getPublicUrl(storagePath)
  return pub.publicUrl
}

async function extractFromImage(
  apiKey: string,
  base64: string,
  mediaType: MediaType,
): Promise<ScanResult> {
  const client = new Anthropic({ apiKey })

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: '掲載タイトル。40字以内。何をしている人・店・活動かが一読で判る短い文にする。',
              },
              body: {
                type: 'string',
                description:
                  '紹介本文。200〜400字。チラシに書かれている事実（対象年齢・定員・料金・開催頻度・場所・体験の有無・実績年数など）を拾って具体的に書く。' +
                  'チラシに書かれていないことは推測で補わない。誇張表現や「素晴らしい」等の評価語は使わない。',
              },
              category: {
                type: 'string',
                enum: CATEGORY_KEYS,
                description: '掲載カテゴリ。最も近いものを1つ選ぶ。',
              },
              location: { ...nullableString, description: '場所・所在地。例: 印西市草深／印西牧の原駅前。読み取れなければ null。' },
              sns_display_name: {
                ...nullableString,
                description:
                  '店名・教室名・屋号・団体名。SNSで名指しするために使う。' +
                  '個人の氏名しか書かれていない場合は、勝手に公開しないため必ず null にする。',
              },
              coupon_content: {
                ...nullableString,
                description: '「初回無料」「◯◯円引き」等の特典・クーポンの記載があれば80字以内で。無ければ null。',
              },
              confidence: { type: 'number', description: '0〜1の抽出自信度' },
            },
            required: ['title', 'body', 'category', 'location', 'sns_display_name', 'coupon_content', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      system:
        '地域の掲示板に載せる「お店・教室・個人の活動」の紹介文を、チラシや店頭の写真から起こすアシスタント。' +
        '読み取れた事実だけを使い、書かれていないことは補わない。' +
        '屋号・教室名・団体名は sns_display_name に入れるが、個人の氏名しか無い場合は null にする（本人の同意なく実名を公開しないため）。' +
        '画像がチラシ・看板・商品写真等のいずれでもなく内容を読み取れない場合は title="（読み取り失敗）", confidence=0 を返す。',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: 'この画像から、地域掲示板に載せる紹介情報を抽出してください。' },
          ],
        },
      ],
    })
  } catch (err) {
    return { ok: false, reason: classifyScanError(err) }
  }

  if (response.stop_reason === 'refusal') {
    console.error('[freefree/scan] AI extraction refused by model')
    return { ok: false, reason: 'parse' }
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    console.error('[freefree/scan] unexpected response shape (no text block)')
    return { ok: false, reason: 'parse' }
  }

  try {
    return { ok: true, data: JSON.parse(textBlock.text) as Record<string, unknown>, usage: response.usage }
  } catch (err) {
    console.error('[freefree/scan] JSON parse failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'parse' }
  }
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
    return NextResponse.json({ ok: false, reason: 'too_large', image_url: null })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `unsupported media type: ${file.type}` }, { status: 415 })
  }
  const mediaType = file.type as MediaType

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString('base64')

  // 画像アップロードと AI 抽出は独立。AI が失敗してもアップロード結果は返す
  const uploadPromise = uploadImage(supabase, user.id, buf, mediaType)

  let scan: ScanResult
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[freefree/scan] ANTHROPIC_API_KEY not configured')
    scan = { ok: false, reason: 'config' }
  } else if (base64.length > MAX_BASE64_CHARS) {
    scan = { ok: false, reason: 'too_large' }
  } else {
    scan = await extractFromImage(apiKey, base64, mediaType)
  }

  const image_url = await uploadPromise

  if (!scan.ok) {
    return NextResponse.json({ ok: false, reason: scan.reason, image_url })
  }

  return NextResponse.json({
    ok: true,
    ...scan.data,
    image_url,
    model: 'claude-opus-4-7',
    usage: scan.usage,
  })
}
