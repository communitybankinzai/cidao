// match-orgs 共通ロジック
// /api/ai/match-orgs/route.ts と /me/page.tsx の両方から呼び出せるよう lib に抽出

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

const CANDIDATE_LIMIT = 30
const TOP_N = 5

export type EnrichedMatch = {
  org_id: string
  name: string
  description: string | null
  type: string
  score: number
  reason: string
}

export type MatchResult =
  | { ok: true; matches: EnrichedMatch[]; method: string; candidate_count: number }
  | { ok: false; reason: 'member_not_found' | 'no_interests' | 'no_candidates'; matches: [] }

export async function findMatchingOrgs(
  memberId: string,
  supabase: SupabaseClient,
): Promise<MatchResult> {
  const { data: member } = await supabase
    .from('members')
    .select('display_name, interests, self_introduction')
    .eq('id', memberId)
    .single()
  if (!member) return { ok: false, reason: 'member_not_found', matches: [] }

  const interests = (member.interests ?? []) as string[]
  if (interests.length === 0) return { ok: false, reason: 'no_interests', matches: [] }

  // 1. category overlap で候補団体を絞り込み
  const { data: orgCats } = await supabase
    .from('organization_categories')
    .select('org_id, category')
    .in('category', interests)

  const overlapByOrg = new Map<string, number>()
  for (const row of orgCats ?? []) {
    overlapByOrg.set(row.org_id, (overlapByOrg.get(row.org_id) ?? 0) + 1)
  }

  if (overlapByOrg.size === 0) return { ok: false, reason: 'no_candidates', matches: [] }

  const candidateIds = Array.from(overlapByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_LIMIT)
    .map(([id]) => id)

  // 2. 候補団体の name + description + type を取得
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, description, type')
    .in('id', candidateIds)
    .eq('public_flag', true)

  const candidates = (orgs ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description ?? '',
    type: o.type,
    overlap: overlapByOrg.get(o.id) ?? 0,
  }))

  // 候補が TOP_N 以下なら LLM スキップ
  if (candidates.length <= TOP_N) {
    return {
      ok: true,
      matches: candidates
        .sort((a, b) => b.overlap - a.overlap)
        .map((c) => ({
          org_id: c.id,
          name: c.name,
          description: c.description || null,
          type: c.type,
          score: Math.min(1, c.overlap / interests.length),
          reason: `あなたの興味分野と ${c.overlap} 件のカテゴリが一致`,
        })),
      method: 'category_overlap_only',
      candidate_count: candidates.length,
    }
  }

  // 3. Claude による rerank
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      ok: true,
      matches: candidates
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, TOP_N)
        .map((c) => ({
          org_id: c.id,
          name: c.name,
          description: c.description || null,
          type: c.type,
          score: Math.min(1, c.overlap / interests.length),
          reason: 'カテゴリ重なり（AI rerank 未設定）',
        })),
      method: 'category_overlap_fallback',
      candidate_count: candidates.length,
    }
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
    throw new Error('Anthropic response: unexpected shape')
  }

  const parsed = JSON.parse(textBlock.text) as {
    matches: { org_id: string; score: number; reason: string }[]
  }

  const candidateById = new Map(candidates.map((c) => [c.id, c]))
  const safeMatches: EnrichedMatch[] = parsed.matches
    .filter((m) => candidateById.has(m.org_id))
    .slice(0, TOP_N)
    .map((m) => {
      const c = candidateById.get(m.org_id)!
      return {
        org_id: m.org_id,
        name: c.name,
        description: c.description || null,
        type: c.type,
        score: m.score,
        reason: m.reason,
      }
    })

  return {
    ok: true,
    matches: safeMatches,
    method: 'claude-opus-4-7-rerank',
    candidate_count: candidates.length,
  }
}
