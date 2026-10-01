// GET/POST /api/cron/instagram-events-sync
//
// Instagram #印西 の直近24時間の公開投稿から、チラシ画像を AI（既定 claude-sonnet-5）で読み取り、
// CiDAO の events に external_source='instagram-hashtag'・status='draft' で入れる
// （運営が管理画面「イベント一括取り込み」で公開／見送りを決める。運営決定 2026-10-01：#印西・下書き・月 500 円まで）。
// 画像は転載せず、投稿リンクを出典に付ける。
//
// 実行後に結果報告メール（一覧・経費・一時停止ボタン）を送る。同じ朝のアカウント巡回
// （/api/cron/instagram-accounts-sync・06:32）の記録があれば、その結果も同じメールに載せる。
// ?report=1 は同期せず直近の実行記録からメールだけ送り直す。
// 一時停止中（app_settings instagram_events_sync.paused）は何もせず記録だけ残す。
//
// 認証: Authorization: Bearer <CRON_SECRET>（他の cron と同じ）。?dry=1 で書き込みなし（AI の読み取りと費用記録は行う）。
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INGEST_BOT_MEMBER_ID / ANTHROPIC_API_KEY
//           任意: INSTAGRAM_EVENT_SCAN_MODEL（既定 claude-sonnet-5）/ INSTAGRAM_EVENT_SCAN_BUDGET_JPY（既定 500）
//                 INSTAGRAM_EVENT_SCAN_MAX_PER_RUN（既定 12）
//           メール: RESEND_API_KEY / MAIL_FROM / INSTAGRAM_EVENT_REPORT_TO（無ければ COST_ALERT_TO 宛て）

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeMailFrom } from '@/lib/mail'
import { emptyFailedResult, recordSyncRun } from '@/lib/event-sync/record-run'
import { INSTAGRAM_EVENT_HASHTAG, INSTAGRAM_HASHTAG_SOURCE } from '@/lib/instagram-events/hashtag'
import { INSTAGRAM_ACCOUNT_SOURCE } from '@/lib/instagram-events/accounts'
import { describePauseState, pausePageUrl, readPauseState } from '@/lib/instagram-events/pause'
import { buildReportMail, resultFromRunRow, type AccountSection, type ReportResult } from '@/lib/instagram-events/report-mail'
import { costSums, makeIgSyncDb } from '@/lib/instagram-events/db-supabase'
import {
  DEFAULT_BUDGET_JPY,
  DEFAULT_MAX_SCANS_PER_RUN,
  DEFAULT_SCAN_MODEL,
  DEFAULT_TIME_BUDGET_MS,
  syncInstagramEvents,
  type IgSyncResult,
} from '@/lib/instagram-events/sync'

export const dynamic = 'force-dynamic'
// #印西 は投稿が多く Graph API の 1 ページに約 9 秒かかる（2026-10-01 実測）ため、他の cron より長めに取る。
// 実際の打ち切りは syncInstagramEvents の時間予算（既定 100 秒）で行う
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

type RunRow = {
  started_at: string
  finished_at: string
  ok: boolean
  dry_run: boolean
  fetched: ReportResult['fetched'] | null
  errors: string[] | null
  unchanged: number | null
  detail: Record<string, unknown> | null
}

async function latestRun(supabase: SupabaseClient, source: string, sinceIso?: string): Promise<RunRow | null> {
  let q = supabase
    .from('event_sync_runs')
    .select('started_at, finished_at, ok, dry_run, fetched, errors, unchanged, detail')
    .eq('source', source)
    .eq('dry_run', false)
  if (sinceIso) q = q.gte('started_at', sinceIso)
  const { data, error } = await q.order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`latestRun(${source}): ${error.message}`)
  return (data as RunRow | null) ?? null
}

/** 同じ朝（JST の今日）のアカウント巡回の記録。一時停止で飛ばした記録は載せない */
async function accountSectionForToday(supabase: SupabaseClient): Promise<AccountSection | null> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  const row = await latestRun(supabase, INSTAGRAM_ACCOUNT_SOURCE, new Date(`${today}T00:00:00+09:00`).toISOString())
  if (!row || row.detail?.paused) return null
  return { result: resultFromRunRow(row), startedAt: new Date(row.started_at), finishedAt: new Date(row.finished_at) }
}

type MailCtx = { supabase: SupabaseClient; model: string; cronSecret: string; siteBase: string }

/** 結果報告メール。失敗しても同期結果は返す（戻り値は送信状況の文字列） */
async function sendReportMail(ctx: MailCtx, result: ReportResult, startedAt: Date, finishedAt: Date): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.MAIL_FROM ?? ''
  const to = process.env.INSTAGRAM_EVENT_REPORT_TO || process.env.COST_ALERT_TO || ''
  if (!apiKey || !from || !to) return 'skipped: RESEND_API_KEY / MAIL_FROM / INSTAGRAM_EVENT_REPORT_TO (COST_ALERT_TO) not configured'
  try {
    const [sums, accounts] = await Promise.all([costSums(ctx.supabase), accountSectionForToday(ctx.supabase)])
    const mail = buildReportMail({
      result, startedAt, finishedAt, model: ctx.model, hashtag: INSTAGRAM_EVENT_HASHTAG,
      monthCostJpy: sums.month, totalCostJpy: sums.total,
      adminUrl: `${ctx.siteBase}/admin/events/import`,
      monitorUrl: `${ctx.siteBase}/admin/sns-monitor`,
      pauseUrl: pausePageUrl(ctx.siteBase, ctx.cronSecret),
      accounts,
    })
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from: normalizeMailFrom(from), to, subject: mail.subject, html: mail.html, text: mail.text })
    return error ? `send failed: ${error.message}` : 'sent'
  } catch (e) {
    return `send failed: ${e instanceof Error ? e.message : String(e)}`
  }
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
  const botMemberId = process.env.INGEST_BOT_MEMBER_ID ?? ''
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!supaUrl || !serviceKey || !botMemberId || !apiKey) {
    return NextResponse.json({ error: 'supabase service role / INGEST_BOT_MEMBER_ID / ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const model = process.env.INSTAGRAM_EVENT_SCAN_MODEL || DEFAULT_SCAN_MODEL
  const budgetJpy = numberEnv('INSTAGRAM_EVENT_SCAN_BUDGET_JPY', DEFAULT_BUDGET_JPY)
  const maxScansPerRun = numberEnv('INSTAGRAM_EVENT_SCAN_MAX_PER_RUN', DEFAULT_MAX_SCANS_PER_RUN)
  const db = makeIgSyncDb(supabase, botMemberId)

  const params = new URL(request.url).searchParams
  const dryRun = params.get('dry') === '1'
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app').replace(/\/$/, '')
  const mailCtx: MailCtx = { supabase, model, cronSecret, siteBase }

  // ?report=1：同期せず、直近の本実行の記録からメールだけ送り直す（体裁の確認・再送用）
  if (params.get('report') === '1') {
    const row = await latestRun(supabase, INSTAGRAM_HASHTAG_SOURCE)
    if (!row) return NextResponse.json({ ok: false, error: 'no run recorded yet' }, { status: 404 })
    const usedModel = typeof row.detail?.model === 'string' ? row.detail.model : model
    const mail = await sendReportMail({ ...mailCtx, model: usedModel }, resultFromRunRow(row), new Date(row.started_at), new Date(row.finished_at))
    console.log(`[instagram-events-sync] report-only: ${mail}`)
    return NextResponse.json({ ok: !/failed/.test(mail), reportOnly: true, mail })
  }

  const startedAt = new Date()

  // 一時停止中（メールのボタン／管理画面）は何もせず、記録だけ残す
  const pause = await readPauseState(supabase)
  if (pause.paused) {
    const skippedResult: IgSyncResult = {
      ok: true,
      fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
      inserted: [], updated: [], unchanged: 0, skipped: [`一時停止中：${describePauseState(pause)}`], duplicates: [], errors: [], dryRun,
      scanned: [], costJpy: 0, budget: { monthBeforeJpy: 0, limitJpy: budgetJpy, exhausted: false },
      prefilter: { noImage: 0, noDate: 0, noEventWord: 0, notEvent: 0, already: 0, passed: 0 },
    }
    await recordSyncRun(supabase, INSTAGRAM_HASHTAG_SOURCE, startedAt, skippedResult, { paused: true, pausedState: pause })
    console.log('[instagram-events-sync] paused; nothing done')
    return NextResponse.json({ ok: true, paused: true, state: pause })
  }

  let result: IgSyncResult
  try {
    result = await syncInstagramEvents(db, {
      apiKey, botMemberId, dryRun, model, budgetJpy, maxScansPerRun, timeBudgetMs: DEFAULT_TIME_BUDGET_MS,
      log: (m) => console.warn('[instagram-events-sync]', m),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordSyncRun(supabase, INSTAGRAM_HASHTAG_SOURCE, startedAt, emptyFailedResult(message, dryRun))
    console.error('[instagram-events-sync] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
  const finishedAt = new Date()
  await recordSyncRun(supabase, INSTAGRAM_HASHTAG_SOURCE, startedAt, result, {
    scanned: result.scanned, costJpy: result.costJpy, budget: result.budget, prefilter: result.prefilter, model,
  })
  // 結果報告メール（確認のみの実行では送らない。?mail=1 で送れる）
  const mail = dryRun && params.get('mail') !== '1' ? 'skipped: dry run' : await sendReportMail(mailCtx, { ...result, accounts: null }, startedAt, finishedAt)
  console.log(
    `[instagram-events-sync] ${dryRun ? '(dry) ' : ''}posts=${result.fetched.list} passed=${result.fetched.calendar} scanned=${result.fetched.details} failed=${result.fetched.detailFailed} cost=${result.costJpy.toFixed(1)}JPY inserted=${result.inserted.length} duplicates=${result.duplicates.length} skipped=${result.skipped.length} errors=${result.errors.length} mail=${mail}`,
  )
  return NextResponse.json({ ...result, mail }, { status: result.ok ? 200 : 500 })
}
