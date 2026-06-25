// Step 11b スタブ: AI 団体マッチング (F11)
// 入力: 新規登録メンバーの interests + 自己紹介 → マッチする団体 5 件
// 暫定: interests カテゴリと organization_categories の重複度だけで判定

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { memberId } = await request.json()
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const supabase = await createClient()

  const { data: member } = await supabase
    .from('members')
    .select('interests')
    .eq('id', memberId)
    .single()
  if (!member) return NextResponse.json({ error: 'member not found' }, { status: 404 })

  const interests = (member.interests ?? []) as string[]
  if (interests.length === 0) return NextResponse.json({ matches: [] })

  // 興味カテゴリと organization_categories の overlap で簡易マッチング
  const { data: orgCats } = await supabase
    .from('organization_categories')
    .select('org_id, category')
    .in('category', interests)

  const scoreByOrg = new Map<string, number>()
  for (const row of orgCats ?? []) {
    scoreByOrg.set(row.org_id, (scoreByOrg.get(row.org_id) ?? 0) + 1)
  }

  const top = Array.from(scoreByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => ({ org_id: id, score }))

  return NextResponse.json({
    matches: top,
    method: 'category_overlap',
    note: 'AI API キー取得後に embedding ベースの類似度に置換予定 (Step 11c)',
  })
}
