// Step 11c: AI 提案カテゴリ分類（@anthropic-ai/sdk）
// 入力: title + body → PROPOSAL_CATEGORIES のキー（"machizukuri" / "kodomo" / ... / "other"）
//
// env: ANTHROPIC_API_KEY（必須）

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'

const CATEGORY_KEYS = PROPOSAL_CATEGORIES.map((c) => c.key)

export async function POST(request: Request) {
  const { title, body } = await request.json()
  if (typeof title !== 'string' || typeof body !== 'string') {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    )
  }

  const client = new Anthropic({ apiKey })

  const categoryList = PROPOSAL_CATEGORIES.map((c) => `- ${c.key}: ${c.label}`).join('\n')

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 256,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORY_KEYS },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
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

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'unexpected response shape' }, { status: 502 })
  }

  const parsed = JSON.parse(textBlock.text) as {
    category: string
    confidence: number
    reason: string
  }

  return NextResponse.json({
    category: parsed.category,
    confidence: parsed.confidence,
    reason: parsed.reason,
    method: 'claude-opus-4-7',
    usage: response.usage,
  })
}
