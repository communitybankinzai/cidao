// POST /api/sns/rotate
// 各 target_type で 1 件ずつ最も古く紹介された対象を選び、
// X / Facebook / LINE 3媒体に対して pending log を作る。
// pg_cron からの呼び出しは不要（DB側で run_sns_rotation_cycle を直接実行）。
// この endpoint は管理画面の手動「今すぐ実行」ボタン用。

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let perKind = 1
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body.per_kind === 'number' && body.per_kind > 0 && body.per_kind <= 5) {
      perKind = body.per_kind
    }
  } catch { /* default */ }

  const { data, error } = await supabase.rpc('run_sns_rotation_cycle', { per_kind: perKind })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    picked: data,
    note: 'pending log を作成しました。実投稿は /api/sns/dispatch を呼んでください。',
  })
}
