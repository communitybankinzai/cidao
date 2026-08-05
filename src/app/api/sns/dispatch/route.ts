// POST /api/sns/dispatch
// sns_post_logs のうち「未送信かつ運営承認済み」の行を読み、各媒体 API を呼んで実投稿する。
// 本文は管理画面（/admin/sns）で確認・承認されたものをそのまま送る。
// 認証情報が未設定の媒体は pending のまま error_message='credentials missing' にする。
// 実際の投稿処理は src/lib/sns-dispatch.ts に共通化してある
// （提案作成時の全自動配信と同じコードパスを通す）。

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchLogs } from '@/lib/sns-dispatch'
import type { SnsMedium } from '@/lib/sns-template'

type Log = {
  id: string
  target_type: 'freefree' | 'event' | 'org' | 'proposal'
  target_id: string
  medium: SnsMedium
  status: 'success' | 'failed' | 'pending'
  content: string | null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let maxLogs = 30
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body.max === 'number' && body.max > 0 && body.max <= 100) {
      maxLogs = body.max
    }
  } catch { /* default */ }

  // 運営が承認した本文だけを配信する（開発仕様書 v2.1 §3.11.4）。
  // 未承認のものは管理画面（/admin/sns）で確認・修正・承認するまで送らない。
  const { data: pendings, error } = await supabase
    .from('sns_post_logs')
    .select('id, target_type, target_id, medium, status, content')
    .eq('status', 'pending')
    .not('approved_at', 'is', null)
    .order('created_at', { ascending: true })
    .limit(maxLogs)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = await dispatchLogs(supabase, (pendings ?? []) as Log[])
  return NextResponse.json({ processed: results.length, results })
}
