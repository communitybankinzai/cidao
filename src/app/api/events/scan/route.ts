// チラシ画像 → Claude Vision で構造化抽出 → /events/new のフォーム自動入力に使う
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 未ログインは弾く（イベント新規登録ページ自体がログイン必須なので整合）

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  const form = await request.formData()
  const file = form.get('image')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'image (multipart File) required' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `image too large (>${MAX_BYTES} bytes)` }, { status: 413 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `unsupported media type: ${file.type}` }, { status: 415 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString('base64')

  // JST の今日（API ルートなので Date 使用 OK）
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
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
              media_type: file.type as MediaType,
              data: base64,
            },
          },
          { type: 'text', text: 'このイベントチラシから情報を抽出してください。' },
        ],
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    return NextResponse.json({ error: 'refused by model' }, { status: 422 })
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'unexpected response shape' }, { status: 502 })
  }

  const parsed = JSON.parse(textBlock.text)

  return NextResponse.json({
    ...parsed,
    model: 'claude-opus-4-7',
    usage: response.usage,
  })
}
