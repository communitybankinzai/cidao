// GET/POST /api/cron/inzai-city-sync
//
// 印西市公式サイトの「イベント・お知らせ」月別カレンダー（当月＋2か月）と各ページを読み、
// external_source='inzai-city-calendar'・status='draft' で候補を入れる（運営が管理画面で公開／見送り）。
// AI は使わない。認証・?dry=1・実行記録は他の取り込み cron と同じ。

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { INZAI_CITY_SOURCE } from '@/lib/inzai-city/calendar'
import { syncInzaiCity } from '@/lib/inzai-city/sync'
import type { CosmosExistingRow, CosmosSyncDb } from '@/lib/goguynet/sync'
import { emptyFailedResult, recordSyncRun } from '@/lib/event-sync/record-run'
import type { EventRow, OtherEventRow, SyncResult } from '@/lib/inzai-bunka/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const botMemberId = process.env.INGEST_BOT_MEMBER_ID ?? ''
  if (!supaUrl || !serviceKey || !botMemberId) {
    return NextResponse.json({ error: 'supabase service role / INGEST_BOT_MEMBER_ID not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const db: CosmosSyncDb = {
    async listExisting() {
      const { data, error } = await supabase
        .from('events')
        .select('id, external_source_id, status, title, description, start_at, end_at, location, fee')
        .eq('external_source', INZAI_CITY_SOURCE)
      if (error) throw new Error(`listExisting: ${error.message}`)
      return (data ?? []) as CosmosExistingRow[]
    },
    async listOtherFutureEvents(fromDate: string) {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_at, location, organizer_name_text')
        .gte('start_at', `${fromDate}T00:00:00+09:00`)
        .or(`external_source.is.null,external_source.neq.${INZAI_CITY_SOURCE}`)
        .limit(2000)
      if (error) throw new Error(`listOtherFutureEvents: ${error.message}`)
      return (data ?? []) as OtherEventRow[]
    },
    async insert(row: EventRow) {
      const { error } = await supabase.from('events').insert(row)
      if (error) throw new Error(`insert: ${error.message}`)
    },
    async update(id: string, patch: Partial<EventRow>) {
      const { error } = await supabase.from('events').update(patch).eq('id', id)
      if (error) throw new Error(`update: ${error.message}`)
    },
  }

  const dryRun = new URL(request.url).searchParams.get('dry') === '1'
  const startedAt = new Date()
  let result: SyncResult
  try {
    result = await syncInzaiCity(db, { botMemberId, dryRun, log: (m) => console.warn('[inzai-city-sync]', m) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordSyncRun(supabase, INZAI_CITY_SOURCE, startedAt, emptyFailedResult(message, dryRun))
    console.error('[inzai-city-sync] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
  await recordSyncRun(supabase, INZAI_CITY_SOURCE, startedAt, result)
  console.log(
    `[inzai-city-sync] ${dryRun ? '(dry) ' : ''}pages=${result.fetched.list} details=${result.fetched.details}/${result.fetched.detailFailed}fail merged=${result.fetched.merged} future=${result.fetched.future} inserted=${result.inserted.length} updated=${result.updated.length} unchanged=${result.unchanged} duplicates=${result.duplicates.length} errors=${result.errors.length}`,
  )
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
