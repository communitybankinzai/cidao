// Step 11c: AI 提案カテゴリ分類（@anthropic-ai/sdk）
// 入力: title + body → PROPOSAL_CATEGORIES のキー（"machizukuri" / "kodomo" / ... / "other"）
//
// env: ANTHROPIC_API_KEY（必須）
// 認可: 未ログインは弾く。AI 呼び出しは課金が発生するため、公開エンドポイントにしない
//
// 分類はあくまで入力補助。AI 側の失敗は HTTP 200 で { ok: false, reason } を返し、
// 呼び出し元のフォームが 500 で止まらないようにする（/api/events/scan と同じ方針）。

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { createClient } from '@/lib/supabase/server'

const CATEGORY_KEYS = PROPOSAL_CATEGORIES.map((c) => c.key)

// quota: クレジット不足・レート制限 / config: キー不正 / busy: 過負荷・タイムアウト
// parse: 応答が解釈できない / unknown: その他
type ClassifyFailReason = 'quota' | 'config' | 'busy' | 'parse' | 'unknown'

function classifyAiError(err: unknown): ClassifyFailReason {
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const message = err instanceof Error ? err.message : String(err)
  console.error('[ai/classify-proposal] AI request failed:', status ?? '(no status)', message)
  if (/credit balance/i.test(message)) return 'quota'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503) return 'busy'
  if (/timeout|timed out|aborted/i.test(message)) return 'busy'
  return 'unknown'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let payload: { title?: unknown; body?: unknown }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { title, body } = payload
  if (typeof title !== 'string' || typeof body !== 'string') {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[ai/classify-proposal] ANTHROPIC_API_KEY not configured')
    return NextResponse.json({ ok: false, reason: 'config' })
  }

  const client = new Anthropic({ apiKey })

  const categoryList = PROPOSAL_CATEGORIES.map((c) => `- ${c.key}: ${c.label}`).join('\n')

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 256,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: CATEGORY_KEYS },
              confidence: { type: 'number' },
              reason: { type: 'string' },
            },
            required: ['category', 'confidence', 'reason'],
            additionalProperties: false,
          },
        },
      },
      system:
        '印西市の市民活動団体（CBI）に寄せられた市民提案を、所定の9カテゴリの1つに分類するアシスタント。' +
        '与えられた title と body の内容を読み取り、最も適切な category キー1つと、0〜1の confidence、' +
        '簡潔な reason（日本語30字以内）を JSON で返してください。複数候補がある場合は最頻に近いものを選び、' +
        'どのカテゴリにも明確に当てはまらない場合のみ "other" を返してください。',
      messages: [
        {
          role: 'user',
          content:
            `# 利用可能なカテゴリ\n${categoryList}\n\n` +
            `# 分類対象\n## title\n${title}\n\n## body\n${body}`,
        },
      ],
    })
  } catch (err) {
    return NextResponse.json({ ok: false, reason: classifyAiError(err) })
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    console.error('[ai/classify-proposal] unexpected response shape (no text block)')
    return NextResponse.json({ ok: false, reason: 'parse' })
  }

  let parsed: { category: string; confidence: number; reason: string }
  try {
    parsed = JSON.parse(textBlock.text)
  } catch (err) {
    console.error(
      '[ai/classify-proposal] JSON parse failed:',
      err instanceof Error ? err.message : String(err),
    )
    return NextResponse.json({ ok: false, reason: 'parse' })
  }

  return NextResponse.json({
    ok: true,
    category: parsed.category,
    confidence: parsed.confidence,
    reason: parsed.reason,
    method: 'claude-opus-4-7',
    usage: response.usage,
  })
}
