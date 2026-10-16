// GET /api/cron/instagram-health
//
// Instagram 巡回（instagram-accounts-sync 06:32・instagram-events-sync 06:35）が止まっていないかを、
// 読み取りだけで確かめる。AI の読み取り・費用の記録・DB への書き込みはしない（dry-run より安全で、費用もかからない）。
// 見るもの: 検索用トークンの debug_token／監視アカウントへの business_discovery／ハッシュタグ検索／
//          直近の本実行の記録／一時停止の状態。トークンの値は返さない（末尾4桁だけ）。
//
// 認証: Authorization: Bearer <CRON_SECRET>。正常は 200、異常（fail）は 503、注意（warn）は 200。
// vercel.json の crons には載せない（人が必要なときに呼ぶ口）。

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { INSTAGRAM_ACCOUNT_SOURCE, type MonitorAccount } from '@/lib/instagram-events/accounts'
import { checkInstagramHealth, type RecentRun } from '@/lib/instagram-events/health'
import { INSTAGRAM_HASHTAG_SOURCE } from '@/lib/instagram-events/hashtag'
import { readPauseState } from '@/lib/instagram-events/pause'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) return NextResponse.json({ error: 'supabase service role not configured' }, { status: 503 })
  const supabase = createSupabaseClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const [authRow, accountRows, runRows, pause] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'sns_instagram_discovery_auth').maybeSingle(),
      supabase.from('sns_monitor_accounts').select('id, username, label, kind, org_id').eq('platform', 'instagram').eq('enabled', true).order('created_at', { ascending: true }).limit(20),
      supabase.from('event_sync_runs').select('source, started_at, ok, errors').in('source', [INSTAGRAM_ACCOUNT_SOURCE, INSTAGRAM_HASHTAG_SOURCE]).eq('dry_run', false).order('started_at', { ascending: false }).limit(10),
      readPauseState(supabase),
    ])
    if (authRow.error) throw new Error(`app_settings: ${authRow.error.message}`)
    if (accountRows.error) throw new Error(`sns_monitor_accounts: ${accountRows.error.message}`)
    if (runRows.error) throw new Error(`event_sync_runs: ${runRows.error.message}`)

    const v = (authRow.data?.value ?? null) as { user_id?: string; access_token?: string } | null
    const auth = v?.user_id && v?.access_token ? { user_id: String(v.user_id), access_token: String(v.access_token) } : null
    const accounts: MonitorAccount[] = (accountRows.data ?? []).map((r) => ({
      id: r.id as string, username: r.username as string, label: (r.label as string) ?? '', kind: (r.kind as MonitorAccount['kind']) ?? 'その他', orgId: (r.org_id as string | null) ?? null,
    }))

    const report = await checkInstagramHealth({
      fetchFn: fetch, now: new Date(), auth, accounts, recentRuns: (runRows.data ?? []) as RecentRun[], paused: pause.paused,
    })
    return NextResponse.json(report, { status: report.status === 'fail' ? 503 : 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[instagram-health] failed:', message)
    return NextResponse.json({ status: 'fail', error: message }, { status: 500 })
  }
}
