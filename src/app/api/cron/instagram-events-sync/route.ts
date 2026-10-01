// GET/POST /api/cron/instagram-events-sync
//
// Instagram #印西 の直近24時間の公開投稿から、チラシ画像を AI（既定 claude-sonnet-5）で読み取り、
// CiDAO の events に external_source='instagram-hashtag'・status='draft' で入れる
// （運営が管理画面「イベント一括取り込み」で公開／見送りを決める。運営決定 2026-10-01：#印西・下書き・月 500 円まで）。
// 画像は転載せず、投稿リンクを出典に付ける。
//
// 認証: Authorization: Bearer <CRON_SECRET>（他の cron と同じ）。?dry=1 で書き込みなし（AI の読み取りと費用記録は行う）。
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INGEST_BOT_MEMBER_ID / ANTHROPIC_API_KEY
//           任意: INSTAGRAM_EVENT_SCAN_MODEL（既定 claude-sonnet-5）/ INSTAGRAM_EVENT_SCAN_BUDGET_JPY（既定 500）
//                 INSTAGRAM_EVENT_SCAN_MAX_PER_RUN（既定 12）

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { estimateCost, unavailableCost } from '@/lib/ai/pricing'
import { recordApiUsage } from '@/lib/talent-bank/usage'
import { emptyFailedResult, recordSyncRun } from '@/lib/event-sync/record-run'
import type { EventRow, OtherEventRow } from '@/lib/inzai-bunka/sync'
import { INSTAGRAM_HASHTAG_SOURCE } from '@/lib/instagram-events/hashtag'
import {
  DEFAULT_BUDGET_JPY,
  DEFAULT_MAX_SCANS_PER_RUN,
  DEFAULT_SCAN_MODEL,
  DEFAULT_TIME_BUDGET_MS,
  INSTAGRAM_SCAN_PURPOSE,
  syncInstagramEvents,
  type IgSyncDb,
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

/** 今月1日 0:00 JST を UTC の ISO で */
function monthStartJstIso(now = new Date()): string {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(now)
  return new Date(`${ym}-01T00:00:00+09:00`).toISOString()
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

  const db: IgSyncDb = {
    async loadDiscoveryAuth() {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'sns_instagram_discovery_auth').maybeSingle()
      if (error) throw new Error(`loadDiscoveryAuth: ${error.message}`)
      const v = (data?.value ?? null) as { user_id?: string; access_token?: string } | null
      return v?.user_id && v?.access_token ? { user_id: String(v.user_id), access_token: String(v.access_token) } : null
    },
    async listExistingSourceIds() {
      const { data, error } = await supabase.from('events').select('external_source_id').eq('external_source', INSTAGRAM_HASHTAG_SOURCE).limit(5000)
      if (error) throw new Error(`listExistingSourceIds: ${error.message}`)
      return ((data ?? []) as { external_source_id: string }[]).map((r) => r.external_source_id).filter(Boolean)
    },
    async listRecentlyScannedIds() {
      const { data, error } = await supabase
        .from('event_sync_runs')
        .select('detail')
        .eq('source', INSTAGRAM_HASHTAG_SOURCE)
        .eq('dry_run', false) // 確認だけの実行（?dry=1）で読んだ投稿は、本実行で読み直す
        .order('started_at', { ascending: false })
        .limit(7)
      if (error) throw new Error(`listRecentlyScannedIds: ${error.message}`)
      const ids: string[] = []
      for (const r of (data ?? []) as { detail: { scanned?: unknown } | null }[]) {
        const scanned = r.detail?.scanned
        if (Array.isArray(scanned)) for (const id of scanned) if (typeof id === 'string') ids.push(id)
      }
      return ids
    },
    async listFutureEvents(fromDate: string) {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_at, location, organizer_name_text')
        .gte('start_at', `${fromDate}T00:00:00+09:00`)
        .limit(3000)
      if (error) throw new Error(`listFutureEvents: ${error.message}`)
      return (data ?? []) as OtherEventRow[]
    },
    async hasEventWithSourceId(sourceId: string) {
      const { data, error } = await supabase.from('events').select('id').eq('external_source_id', sourceId).limit(1)
      if (error) throw new Error(`hasEventWithSourceId: ${error.message}`)
      return (data ?? []).length > 0
    },
    async monthCostJpy() {
      const { data, error } = await supabase
        .from('api_usage')
        .select('est_cost_jpy')
        .eq('purpose', INSTAGRAM_SCAN_PURPOSE)
        .gte('created_at', monthStartJstIso())
        .limit(5000)
      if (error) throw new Error(`monthCostJpy: ${error.message}`)
      return ((data ?? []) as { est_cost_jpy: number | null }[]).reduce((s, r) => s + (Number(r.est_cost_jpy) || 0), 0)
    },
    async insert(row: EventRow) {
      const { error } = await supabase.from('events').insert(row)
      if (error) throw new Error(`insert: ${error.message}`)
    },
    async recordUsage({ model: usedModel, usage, error }) {
      try {
        const cost = usage ? await estimateCost({ model: usedModel, usage }) : unavailableCost()
        await recordApiUsage({
          run_id: randomUUID(), case_id: null, subject_id: null, member_id: botMemberId,
          provider: 'anthropic', model: usedModel, purpose: INSTAGRAM_SCAN_PURPOSE,
          input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
          cache_creation_tokens: usage?.cache_creation_tokens ?? null, cache_read_tokens: usage?.cache_read_tokens ?? null,
          ...cost, error,
        })
        return cost.est_cost_jpy
      } catch {
        console.error('[instagram-events-sync] usage recording failed')
        return null
      }
    },
  }

  const dryRun = new URL(request.url).searchParams.get('dry') === '1'
  const startedAt = new Date()
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
  await recordSyncRun(supabase, INSTAGRAM_HASHTAG_SOURCE, startedAt, result, {
    scanned: result.scanned, costJpy: result.costJpy, budget: result.budget, prefilter: result.prefilter, model,
  })
  console.log(
    `[instagram-events-sync] ${dryRun ? '(dry) ' : ''}posts=${result.fetched.list} passed=${result.fetched.calendar} scanned=${result.fetched.details} failed=${result.fetched.detailFailed} cost=${result.costJpy.toFixed(1)}JPY inserted=${result.inserted.length} duplicates=${result.duplicates.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
  )
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
