// GET/POST /api/cron/goguynet-cosmos-sync
//
// 号外NET 印西版の「コスモスパレット」記事から催しの候補を拾い、CiDAO の events に
// external_source='goguynet-cosmos'・status='draft' で入れる（運営が管理画面で公開／見送りを決める）。
// 本文・写真は転記せず、題名・日時・会場・入場料・記事URLだけ。AI は使わない。
//
// 認証: Authorization: Bearer <CRON_SECRET>（他の cron と同じ）。?dry=1 で書き込みなし。
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / INGEST_BOT_MEMBER_ID

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { GOGUYNET_COSMOS_SOURCE } from '@/lib/goguynet/cosmos'
import { syncGoguynetCosmos, type CosmosExistingRow, type CosmosSyncDb } from '@/lib/goguynet/sync'
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
  if (!supaUrl || !serviceKey || !botMemberId) {
    return NextResponse.json({ error: 'supabase service role / INGEST_BOT_MEMBER_ID not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const db: CosmosSyncDb = {
    async listExisting() {
      const { data, error } = await supabase
        .from('events')
        .select('id, external_source_id, status, title, description, start_at, end_at, location, fee')
        .eq('external_source', GOGUYNET_COSMOS_SOURCE)
      if (error) throw new Error(`listExisting: ${error.message}`)
      return (data ?? []) as CosmosExistingRow[]
    },
    async listOtherFutureEvents(fromDate: string) {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_at, location, organizer_name_text')
        .gte('start_at', `${fromDate}T00:00:00+09:00`)
        .or(`external_source.is.null,external_source.neq.${GOGUYNET_COSMOS_SOURCE}`)
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
    result = await syncGoguynetCosmos(db, { botMemberId, dryRun, log: (m) => console.warn('[goguynet-cosmos-sync]', m) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordSyncRun(supabase, GOGUYNET_COSMOS_SOURCE, startedAt, emptyFailedResult(message, dryRun))
    console.error('[goguynet-cosmos-sync] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
  await recordSyncRun(supabase, GOGUYNET_COSMOS_SOURCE, startedAt, result)
  console.log(
    `[goguynet-cosmos-sync] ${dryRun ? '(dry) ' : ''}articles=${result.fetched.list} withCandidates=${result.fetched.details} merged=${result.fetched.merged} future=${result.fetched.future} inserted=${result.inserted.length} updated=${result.updated.length} unchanged=${result.unchanged} duplicates=${result.duplicates.length} errors=${result.errors.length}`,
  )
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
