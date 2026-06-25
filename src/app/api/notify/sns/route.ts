// Step 11b スタブ: SNS 配信エンドポイント (X / Facebook / LINE)
// sns_post_logs に「pending」で記録する＋外部 API は未接続
// 仕様§3 MVP 18.10「SNS自動配信：X+Facebook+LINE の3媒体、3カテゴリ」

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SnsTargetType = 'event' | 'org' | 'freefree'
type SnsMedium = 'x' | 'facebook' | 'line'

export async function POST(request: Request) {
  const { target_type, target_id, medium, content } = await request.json() as {
    target_type: SnsTargetType
    target_id: string
    medium: SnsMedium
    content: string
  }

  if (!target_type || !target_id || !medium || !content) {
    return NextResponse.json({ error: 'target_type, target_id, medium, content required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sns_post_logs')
    .insert({
      target_type, target_id, medium, status: 'pending',
      error_message: 'API stub: not yet sent (Step 11d で実接続予定)',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  console.log('[notify/sns][stub]', { medium, target_type, target_id, content_len: content.length })

  return NextResponse.json({
    log_id: data?.id,
    accepted: false,
    method: 'stub',
    note: 'X/Facebook/LINE API キー取得後に実投稿予定 (Step 11d)',
  })
}
