// GET/POST /api/cron/threads-refresh
// Threads の長期アクセストークン（60日で失効）を毎週リフレッシュして延長する。
//
// 背景: COCoLa 時代の Threads 自動投稿はトークンをリフレッシュしない構成だったため
//       60日で黙って失効するリスクを抱えていた。CiDAO ではトークンを
//       app_settings（sns_threads_auth）に保管し、この cron が定期的に更新する。
//
// 仕様: GET https://graph.threads.net/refresh_access_token
//         ?grant_type=th_refresh_token&access_token=<現トークン>
//       発行から24時間以上経過した未失効トークンのみリフレッシュ可能。
//       返ってきた新トークンは再び60日有効。週次実行なら十分間に合う。
//
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

async function handle(request: Request) {
  // Vercel は CRON_SECRET があると Authorization: Bearer <CRON_SECRET> を自動付与する
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: 'supabase credentials not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, { auth: { persistSession: false } })

  const { data: row } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sns_threads_auth')
    .maybeSingle()

  const auth = row?.value as { user_id?: string; access_token?: string; username?: string; saved_at?: string } | null
  if (!auth?.access_token) {
    // 管理画面から未設定なら何もしない（環境変数フォールバック分は手動管理）
    return NextResponse.json({ status: 'skipped', reason: 'sns_threads_auth not set' })
  }

  // 発行から24時間未満はリフレッシュ不可の仕様。保存直後の週は skip される
  const savedAt = auth.saved_at ? new Date(auth.saved_at).getTime() : 0
  if (Date.now() - savedAt < 86400_000) {
    return NextResponse.json({ status: 'skipped', reason: 'token younger than 24h' })
  }

  const r = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(auth.access_token)}`,
  )
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    // 失効済みなど。管理画面で再設定してもらうしかないので、状態は変えずエラーだけ返す
    return NextResponse.json(
      { status: 'failed', error: JSON.stringify(j?.error?.message ?? j).slice(0, 300) },
      { status: 502 },
    )
  }

  const expiresInSec = typeof j.expires_in === 'number' ? j.expires_in : 60 * 86400
  const { error } = await supabase.from('app_settings').upsert({
    key: 'sns_threads_auth',
    value: {
      ...auth,
      access_token: String(j.access_token),
      saved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    },
    updated_at: new Date().toISOString(),
  })
  if (error) {
    return NextResponse.json({ status: 'failed', error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    status: 'refreshed',
    username: auth.username ?? null,
    expires_in_days: Math.round(expiresInSec / 86400),
  })
}

export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
