// POST /api/admin/analytics/analyze
// アクセス集計（日別30日＋ページ別前週比）を Claude に渡し、
// 増減要因の仮説と推奨アクションを日本語で生成する。管理者専用。
//
// 集計は admin 専用 RPC（security definer）をログイン中ユーザーの権限で呼ぶため、
// このルート自体が is_admin 判定を通っていれば追加の service role は不要。
//
// エラー分類は /api/ai/classify-proposal と同じ方針（HTTP 200 + reason で返す）。

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

type FailReason = 'quota' | 'config' | 'busy' | 'no-data' | 'unknown'

function classifyAiError(err: unknown): FailReason {
  const status = err instanceof Anthropic.APIError ? err.status : undefined
  const message = err instanceof Error ? err.message : String(err)
  console.error('[admin/analytics/analyze] AI request failed:', status ?? '(no status)', message)
  if (/credit balance/i.test(message)) return 'quota'
  if (status === 429) return 'quota'
  if (status === 401 || status === 403) return 'config'
  if (status === 529 || status === 503) return 'busy'
  if (/timeout|timed out|aborted/i.test(message)) return 'busy'
  return 'unknown'
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
  if (adminError || !isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [dailyRes, byPathRes] = await Promise.all([
    supabase.rpc('page_view_daily', { p_days: 30 }),
    supabase.rpc('page_view_by_path', { p_days: 7 }),
  ])
  const daily = dailyRes.data ?? []
  const byPath = byPathRes.data ?? []
  if (daily.length === 0) return NextResponse.json({ ok: false, reason: 'no-data' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[admin/analytics/analyze] ANTHROPIC_API_KEY not configured')
    return NextResponse.json({ ok: false, reason: 'config' })
  }

  const client = new Anthropic({ apiKey })

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      system:
        'あなたは CiDAO（千葉県印西市の市民参加プラットフォーム）のアクセス分析担当エージェント（A2: 提案・投票分析）です。' +
        '渡された PV（閲覧回数）/ VV（閲覧端末数）の集計から、運営メンバー向けの分析レポートを日本語で書いてください。' +
        '構成: ①全体傾向（2〜3行） ②増減が目立つページとその要因仮説（データから言える範囲で。推測は「仮説」と明記） ' +
        '③推奨アクション（最大3つ、具体的に）。' +
        '誇張や断定を避け、データ量が少ない場合はその旨を明記してください。見出しと箇条書きを使った読みやすいプレーンテキストで出力します。',
      messages: [
        {
          role: 'user',
          content:
            `# 日別 PV / VV（直近30日、JST）\n${JSON.stringify(daily)}\n\n` +
            `# ページ別（pv/vv=直近7日、prev_pv/prev_vv=その前の7日）\n${JSON.stringify(byPath)}`,
        },
      ],
    })
  } catch (err) {
    return NextResponse.json({ ok: false, reason: classifyAiError(err) })
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ ok: false, reason: 'unknown' })
  }

  return NextResponse.json({ ok: true, analysis: textBlock.text, usage: response.usage })
}
