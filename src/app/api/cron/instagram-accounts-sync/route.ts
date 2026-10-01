// GET/POST /api/cron/instagram-accounts-sync
//
// モニタ対象アカウント（団体の sns_links.instagram ＋ sns_monitor_accounts）の直近の投稿を
// Graph API の business_discovery で読み、チラシ画像を AI で読み取って events に
// external_source='instagram-account'・status='draft' で入れる（運営決定 2026-10-01：登録したアカウントが
// イベントを告知したら自動で候補に。公開は運営が管理画面で）。
//
// 毎朝 06:32 JST。結果は同じ朝の /api/cron/instagram-events-sync（06:35）の報告メールに合わせて載る
// （このルート自体はメールを送らない）。一時停止・費用の上限・読み取り済みの記憶はハッシュタグ側と共通。
//
// 認証: Authorization: Bearer <CRON_SECRET>。?dry=1 で書き込みなし（AI の読み取りと費用記録は行う）。
// 環境変数: ハッシュタグ側と同じ。任意: INSTAGRAM_ACCOUNT_LOOKBACK_DAYS（既定 14）

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { emptyFailedResult, recordSyncRun } from '@/lib/event-sync/record-run'
import { INSTAGRAM_ACCOUNT_SOURCE } from '@/lib/instagram-events/accounts'
import { describePauseState, readPauseState } from '@/lib/instagram-events/pause'
import { makeIgSyncDb } from '@/lib/instagram-events/db-supabase'
import {
  ACCOUNT_LOOKBACK_DAYS,
  DEFAULT_BUDGET_JPY,
  DEFAULT_MAX_SCANS_PER_RUN,
  DEFAULT_SCAN_MODEL,
  DEFAULT_TIME_BUDGET_MS,
  syncInstagramAccounts,
  type IgSyncResult,
} from '@/lib/instagram-events/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}

function numberEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const botMemberId = process.env.INGEST_BOT_MEMBER_ID ?? ''
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!supaUrl || !serviceKey || !botMemberId || !apiKey) {
    return NextResponse.json({ error: 'supabase service role / INGEST_BOT_MEMBER_ID / ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const model = process.env.INSTAGRAM_EVENT_SCAN_MODEL || DEFAULT_SCAN_MODEL
  const budgetJpy = numberEnv('INSTAGRAM_EVENT_SCAN_BUDGET_JPY', DEFAULT_BUDGET_JPY)
  const maxScansPerRun = numberEnv('INSTAGRAM_EVENT_SCAN_MAX_PER_RUN', DEFAULT_MAX_SCANS_PER_RUN)
  const lookbackDays = numberEnv('INSTAGRAM_ACCOUNT_LOOKBACK_DAYS', ACCOUNT_LOOKBACK_DAYS)
  const db = makeIgSyncDb(supabase, botMemberId)

  const dryRun = new URL(request.url).searchParams.get('dry') === '1'
  const startedAt = new Date()

  const pause = await readPauseState(supabase)
  if (pause.paused) {
    const skippedResult: IgSyncResult = {
      ok: true,
      fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
      inserted: [], updated: [], unchanged: 0, skipped: [`一時停止中：${describePauseState(pause)}`], duplicates: [], errors: [], dryRun,
      scanned: [], costJpy: 0, budget: { monthBeforeJpy: 0, limitJpy: budgetJpy, exhausted: false },
      prefilter: { noImage: 0, noDate: 0, noEventWord: 0, notEvent: 0, already: 0, passed: 0 },
      accounts: [],
    }
    await recordSyncRun(supabase, INSTAGRAM_ACCOUNT_SOURCE, startedAt, skippedResult, { paused: true, pausedState: pause })
    console.log('[instagram-accounts-sync] paused; nothing done')
    return NextResponse.json({ ok: true, paused: true, state: pause })
  }

  let result: IgSyncResult
  try {
    result = await syncInstagramAccounts(db, {
      apiKey, botMemberId, dryRun, model, budgetJpy, maxScansPerRun, lookbackDays, timeBudgetMs: DEFAULT_TIME_BUDGET_MS,
      log: (m) => console.warn('[instagram-accounts-sync]', m),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordSyncRun(supabase, INSTAGRAM_ACCOUNT_SOURCE, startedAt, emptyFailedResult(message, dryRun))
    console.error('[instagram-accounts-sync] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
  await recordSyncRun(supabase, INSTAGRAM_ACCOUNT_SOURCE, startedAt, result, {
    scanned: result.scanned, costJpy: result.costJpy, budget: result.budget, prefilter: result.prefilter, model, accounts: result.accounts ?? [],
  })
  console.log(
    `[instagram-accounts-sync] ${dryRun ? '(dry) ' : ''}accounts=${(result.accounts ?? []).length} posts=${result.fetched.list} passed=${result.fetched.calendar} scanned=${result.fetched.details} cost=${result.costJpy.toFixed(1)}JPY inserted=${result.inserted.length} duplicates=${result.duplicates.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
  )
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
