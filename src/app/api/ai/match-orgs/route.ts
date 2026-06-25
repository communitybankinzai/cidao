// Step 11c: AI 団体マッチング (F11) — semantic rerank
// ロジック本体は src/lib/match-orgs.ts に抽出（/me/page から直接呼ぶため）
// このルートは外部 API としての wrapper

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findMatchingOrgs } from '@/lib/match-orgs'

export async function POST(request: Request) {
  const { memberId } = await request.json()
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const supabase = await createClient()
  const result = await findMatchingOrgs(memberId, supabase)

  if (!result.ok) {
    if (result.reason === 'member_not_found') {
      return NextResponse.json({ error: 'member not found' }, { status: 404 })
    }
    return NextResponse.json({ matches: [], reason: result.reason })
  }

  return NextResponse.json({
    matches: result.matches,
    method: result.method,
    candidate_count: result.candidate_count,
  })
}
