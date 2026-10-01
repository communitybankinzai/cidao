// チラシ画像 → Claude Vision で構造化抽出する共通部品。
// 呼び出し元: /api/events/scan（管理画面・イベント新規登録のフォーム自動入力）、
//            Instagram #印西 の自動取り込み（src/lib/instagram-events/sync.ts）
//
// API 例外は throw せず reason に分類して返す（呼び出し元が HTTP 200 で ok:false を返せるように）。

import Anthropic from '@anthropic-ai/sdk'
import { classifyScanError, type ScanFailReason } from '@/lib/event-scan'

export type FlyerMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export const FLYER_ALLOWED_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** 抽出結果（構造化出力のスキーマと同じ形） */
export type FlyerExtract = {
  title: string
  description: string
  start_at: string | null
  end_at: string | null
  location: string | null
  online_flag: boolean
  organizer_name: string | null
  capacity: number | null
  fee: number | null
  occurrences: { start_at: string; end_at: string }[]
  confidence: number
}

export type FlyerExtractResult =
  | { ok: true; data: FlyerExtract; usage: Anthropic.Usage }
  | { ok: false; reason: ScanFailReason; usage: Anthropic.Usage | null }

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const

/** JST の今日（YYYY-MM-DD）。年が省略されたチラシの基準日に使う */
export function todayJstString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export async function extractFromFlyer(
  apiKey: string,
  base64: string,
  mediaType: FlyerMediaType,
  opts: { model: string; logTag?: string; now?: Date; hint?: string },
): Promise<FlyerExtractResult> {
  const logTag = opts.logTag ?? 'event-flyer-extract'
  const today = todayJstString(opts.now)
  const client = new Anthropic({ apiKey })

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: opts.model,
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
                description: '終了日時。YYYY-MM-DDTHH:MM 形式（JST）。終了の記載が無い場合は開始の1時間後を入れる。「10/1〜10/18」のような連続した会期の場合は最終日の終了日時を入れる。日付が飛び飛びで occurrences が2件以上ある場合は、1回目の終了日時を入れる。',
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
                  '単発開催の場合は start_at/end_at と同じ内容を1件だけ入れる。' +
                  '「10/1〜10/18」のような連続した会期は日ごとに分けず、start_at/end_at と同じ1件だけを入れる。',
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
        '「7/18（土）・8/9（日）」「毎週土曜」のように、日付が飛び飛びの別々の開催日がある場合は、occurrences に各回の日時を列挙し、start_at/end_at には1回目の日時を入れる（単発開催なら occurrences は1件のみ）。' +
        'ただし「10/1〜10/18」「10月10日（土）〜18日（日）」のように「〜」「から」でつながった連続した会期（展示会・企画展・スタンプラリー・期間限定の催しなど）は日ごとに分けない。start_at に初日の開始時刻（記載がなければ初日の09:00）、end_at に最終日の終了時刻（記載がなければ最終日の17:00）を入れ、occurrences にはその1件だけを入れる。会期中に休館日があっても1件のままにする。' +
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
            {
              type: 'text',
              text: opts.hint
                ? `このイベントチラシから情報を抽出してください。参考情報（投稿の本文）:\n${opts.hint}`
                : 'このイベントチラシから情報を抽出してください。',
            },
          ],
        },
      ],
    })
  } catch (err) {
    return { ok: false, reason: classifyScanError(err, logTag), usage: null }
  }

  if (response.stop_reason === 'refusal') {
    console.error(`[${logTag}] AI extraction refused by model`)
    return { ok: false, reason: 'parse', usage: response.usage }
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    console.error(`[${logTag}] unexpected response shape (no text block)`)
    return { ok: false, reason: 'parse', usage: response.usage }
  }

  try {
    const parsed = JSON.parse(textBlock.text) as FlyerExtract
    return { ok: true, data: parsed, usage: response.usage }
  } catch (err) {
    console.error(`[${logTag}] JSON parse failed:`, err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'parse', usage: response.usage }
  }
}
