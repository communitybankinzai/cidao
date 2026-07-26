// チラシ画像 → Claude Vision で構造化抽出 → /events/new のフォーム自動入力に使う
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 未ログインは弾く（イベント新規登録ページ自体がログイン必須なので整合）
//
// AI 抽出はあくまで入力補助。抽出が失敗しても画像アップロードとイベント登録
// （Server Action 側）は完走できるよう、AI 系の失敗は HTTP 200 で
// { ok: false, reason } を返す（500 を投げない）。

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

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
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const

function classifyScanError(err: unknown): ScanFailReason {
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const message = err instanceof Error ? err.message : String(err)
  console.error('[events/scan] AI extraction failed:', status ?? '(no status)', message)
  if (/credit balance/i.test(message)) return 'quota'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503) return 'busy'
  if (/timeout|timed out|aborted/i.test(message)) return 'busy'
  return 'unknown'
}

// 画像を event-flyers バケットに保存（ベストエフォート。失敗しても null を返すだけ）
async function uploadFlyer(
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

// Claude Vision による構造化抽出。API 例外は throw せず reason に分類して返す
async function extractFromFlyer(
  apiKey: string,
  base64: string,
  mediaType: MediaType,
): Promise<ScanResult> {
  // JST の今日（API ルートなので Date 使用 OK）
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

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
              title: { type: 'string', description: 'イベント名。80字以内に収める。' },
              description: { type: 'string', description: 'チラシ本文を100〜200字で要約。' },
              start_at: {
                ...nullableString,
                description: '開始日時。YYYY-MM-DDTHH:MM 形式（JST）。読み取れない場合 null。',
              },
              end_at: {
                ...nullableString,
                description: '終了日時。YYYY-MM-DDTHH:MM 形式（JST）。終了の記載が無い場合は開始の1時間後を入れる。',
              },
              location: { ...nullableString, description: '会場・場所。例: 中央公民館 第1会議室' },
              online_flag: { type: 'boolean', description: 'オンライン開催ならtrue' },
              organizer_name: { ...nullableString, description: '主催団体名。会場とは別物。判らなければ null。' },
              capacity: { ...nullableInteger, description: '定員（人数）。記載なしは null。' },
              fee: { ...nullableInteger, description: '参加費（円）。無料は 0、記載なしは null。' },
              occurrences: {
                type: 'array',
                description:
                  '同一イベントが複数日程で開催される場合（例: 7/18と8/9の2回開催）、各回の開始・終了日時をここに列挙する。' +
                  '単発開催の場合は start_at/end_at と同じ内容を1件だけ入れる。',
                items: {
                  type: 'object',
                  properties: {
                    start_at: { type: 'string', description: 'YYYY-MM-DDTHH:MM（JST）' },
                    end_at: { type: 'string', description: 'YYYY-MM-DDTHH:MM（JST）' },
                  },
                  required: ['start_at', 'end_at'],
                  additionalProperties: false,
                },
              },
              confidence: { type: 'number', description: '0〜1の抽出自信度' },
            },
            required: [
              'title',
              'description',
              'start_at',
              'end_at',
              'location',
              'online_flag',
              'organizer_name',
              'capacity',
              'fee',
              'occurrences',
              'confidence',
            ],
            additionalProperties: false,
          },
        },
      },
      system:
        'イベントチラシ画像から構造化情報を抽出するアシスタント。' +
        `日時は JST（Asia/Tokyo）。年が省略されている場合は ${today} を起点に最も近い未来の日付を採用する。` +
        '「2026年6月26日（金）13:30-15:00」のような表記は start_at=2026-06-26T13:30, end_at=2026-06-26T15:00 として分解する。' +
        '「7/18（土）・8/9（日）」のように同一イベントが複数日程で開催される場合は、occurrences に各回の日時を列挙する（単発開催なら1件のみ）。' +
        '「主催」「主催団体」「お問合せ」欄から organizer_name を、「会場」「場所」欄から location を抽出（混同しない）。' +
        '画像がイベントチラシでない、または読み取り不能な場合は title="（読み取り失敗）", confidence=0 を返す。',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            { type: 'text', text: 'このイベントチラシから情報を抽出してください。' },
          ],
        },
      ],
    })
  } catch (err) {
    return { ok: false, reason: classifyScanError(err) }
  }

  if (response.stop_reason === 'refusal') {
    console.error('[events/scan] AI extraction refused by model')
    return { ok: false, reason: 'parse' }
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    console.error('[events/scan] unexpected response shape (no text block)')
    return { ok: false, reason: 'parse' }
  }

  try {
    const parsed = JSON.parse(textBlock.text) as Record<string, unknown>
    return { ok: true, data: parsed, usage: response.usage }
  } catch (err) {
    console.error(
      '[events/scan] JSON parse failed:',
      err instanceof Error ? err.message : String(err),
    )
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
    return NextResponse.json({ ok: false, reason: 'too_large', flyer_image_url: null })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `unsupported media type: ${file.type}` }, { status: 415 })
  }
  const mediaType = file.type as MediaType

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString('base64')

  // 画像アップロードと AI 抽出は独立。AI が失敗してもアップロード結果は返す
  const uploadPromise = uploadFlyer(supabase, user.id, buf, mediaType)

  let scan: ScanResult
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[events/scan] ANTHROPIC_API_KEY not configured')
    scan = { ok: false, reason: 'config' }
  } else if (base64.length > MAX_BASE64_CHARS) {
    scan = { ok: false, reason: 'too_large' }
  } else {
    scan = await extractFromFlyer(apiKey, base64, mediaType)
  }

  const flyer_image_url = await uploadPromise

  if (!scan.ok) {
    return NextResponse.json({ ok: false, reason: scan.reason, flyer_image_url })
  }

  return NextResponse.json({
    ok: true,
    ...scan.data,
    flyer_image_url,
    model: 'claude-opus-4-7',
    usage: scan.usage,
  })
}
