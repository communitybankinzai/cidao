// Step 11c: AI 団体マッチング (F11) — semantic rerank
// 入力: memberId → マッチする団体 5 件（score 付き、reason 付き）
//
// 戦略：
//   1. category overlap で候補団体を上限 30 件に絞り込み（DB 側で粗フィルタ）
//   2. organizations.description + member.interests/self_introduction を
//      Claude に渡して top 5 を rerank
//   3. 候補が 5 件以下のときは LLM 呼び出しをスキップして overlap 順で返す
//
// 注：Anthropic は native embedding API を提供していないため、true vector embedding が必要なら
// 別途 Voyage AI などの API キー追加が必要。本実装は LLM-as-ranker による semantic match。
//
// env: ANTHROPIC_API_KEY（必須）

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const CANDIDATE_LIMIT = 30
const TOP_N = 5

export async function POST(request: Request) {
  const { memberId } = await request.json()
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const supabase = await createClient()

  const { data: member } = await supabase
    .from('members')
    .select('id, display_name, interests, self_introduction')
    .eq('id', memberId)
    .single()
  if (!member) return NextResponse.json({ error: 'member not found' }, { status: 404 })

  const interests = (member.interests ?? []) as string[]
  if (interests.length === 0) return NextResponse.json({ matches: [] })

  // 1. category overlap で候補団体を絞り込み
  const { data: orgCats } = await supabase
    .from('organization_categories')
    .select('org_id, category')
    .in('category', interests)

  const overlapByOrg = new Map<string, number>()
  for (const row of orgCats ?? []) {
    overlapByOrg.set(row.org_id, (overlapByOrg.get(row.org_id) ?? 0) + 1)
  }

  if (overlapByOrg.size === 0) return NextResponse.json({ matches: [] })

  const candidateIds = Array.from(overlapByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_LIMIT)
    .map(([id]) => id)

  // 2. 候補団体の description を取得
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, description')
    .in('id', candidateIds)
    .eq('public_flag', true)

  const candidates = (orgs ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description ?? '',
    overlap: overlapByOrg.get(o.id) ?? 0,
  }))

  // 候補が TOP_N 以下なら LLM スキップ
  if (candidates.length <= TOP_N) {
    return NextResponse.json({
      matches: candidates
        .sort((a, b) => b.overlap - a.overlap)
        .map((c) => ({ org_id: c.id, score: c.overlap, reason: 'category_overlap' })),
      method: 'category_overlap_only',
    })
  }

  // 3. Claude による rerank
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      matches: candidates
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, TOP_N)
        .map((c) => ({ org_id: c.id, score: c.overlap, reason: 'category_overlap' })),
      method: 'category_overlap_fallback',
      note: 'ANTHROPIC_API_KEY not configured; returned overlap-only ranking',
    })
  }

  const client = new Anthropic({ apiKey })

  const orgsBlock = candidates
    .map(
      (c, i) =>
        `[${i}] id=${c.id} / 名称=${c.name} / 概要=${c.description.slice(0, 200) || '（概要未登録）'}`,
    )
    .join('\n')

  const memberBlock =
    `display_name: ${member.display_name}\n` +
    `interests: ${interests.join(', ')}\n` +
    `self_introduction: ${(member.self_introduction ?? '').slice(0, 400) || '（自己紹介未登録）'}`

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  org_id: { type: 'string' },
                  score: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['org_id', 'score', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['matches'],
          additionalProperties: false,
        },
      },
    },
    system:
      '印西市の市民活動マッチング担当。新規メンバーの興味・自己紹介と、候補団体の名称・概要から、' +
      `親和性の高い団体を最大 ${TOP_N} 件、降順で選定する。score は 0.0〜1.0、` +
      'reason は団体名と親和性ポイントを日本語 50 字以内で。' +
      'org_id は候補リスト内の値をそのまま返すこと（捏造禁止）。' +
      '該当する団体がなければ空配列を返す。',
    messages: [
      {
        role: 'user',
        content:
          `# メンバー\n${memberBlock}\n\n` +
          `# 候補団体（${candidates.length}件）\n${orgsBlock}\n\n` +
          `上位 ${TOP_N} 件を選定してください。`,
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'unexpected response shape' }, { status: 502 })
  }

  const parsed = JSON.parse(textBlock.text) as {
    matches: { org_id: string; score: number; reason: string }[]
  }

  const candidateIdSet = new Set(candidates.map((c) => c.id))
  const safeMatches = parsed.matches.filter((m) => candidateIdSet.has(m.org_id)).slice(0, TOP_N)

  return NextResponse.json({
    matches: safeMatches,
    method: 'claude-opus-4-7-rerank',
    candidate_count: candidates.length,
    usage: response.usage,
  })
}
