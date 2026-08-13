// GET/POST /api/cron/sns-dispatch
//
// 運営が承認した SNS 投稿を自動配信する。
//
// 背景: 承認しても配信は管理画面の「pending を実投稿」を手で押すまで行われず、
//       承認済みのまま放置される状態だった。承認＝配信予約として扱い、
//       毎日決まった時刻にまとめて配信する。
//
// 起動: Vercel Cron（vercel.json、毎日 09:00 UTC = JST 18:00）。
//       Vercel は CRON_SECRET 環境変数があると Authorization: Bearer <CRON_SECRET>
//       を自動付与するので、手動テストも同じヘッダで叩ける。
//
// 認可: cron からの呼び出しにはログインセッションが無いため service_role で動かす。
//       管理画面の手動ボタン（/api/sns/dispatch）は従来どおり管理者セッションで動く。
//
// 対象: status='pending' かつ approved_at が入っている行のみ。
//       未承認のものは絶対に送らない（開発仕様書 v2.1 §3.11.4）。
//
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { dispatchLogs } from '@/lib/sns-dispatch'
import type { SnsMedium } from '@/lib/sns-template'

// 1回の実行で送る上限。詰まっていても一度に大量投稿してスパム判定されないようにする
const MAX_PER_RUN = 20

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: 'supabase service role not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: pendings, error } = await supabase
    .from('sns_post_logs')
    .select('id, target_type, target_id, medium, content')
    .eq('status', 'pending')
    .not('approved_at', 'is', null)
    .order('approved_at', { ascending: true })
    .limit(MAX_PER_RUN)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!pendings || pendings.length === 0) {
    return NextResponse.json({ processed: 0, results: [], note: '承認済みで未配信のものはありません' })
  }

  const results = await dispatchLogs(
    supabase,
    pendings.map((r) => ({
      id: r.id as string,
      medium: r.medium as SnsMedium,
      content: r.content as string | null,
      target_type: r.target_type as string,
      target_id: r.target_id as string,
    })),
  )

  const success = results.filter((r) => r.outcome === 'success').length
  const failed = results.filter((r) => r.outcome === 'failed').length
  const pending = results.filter((r) => r.outcome === 'pending').length

  return NextResponse.json({ processed: results.length, success, failed, pending, results })
}
