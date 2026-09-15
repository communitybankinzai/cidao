// GET/POST /api/cron/inzai-bunka-sync
//
// 印西市文化ホール（https://www.inzai-bunka.jp/）の公演一覧・詳細・月別カレンダーを読み、
// CiDAO の events に external_source='inzai-bunka-calendar' として登録／更新する。
// AI は使わない（HTML 構造の解析のみ・課金ゼロ）。解析本体は src/lib/inzai-bunka/。
//
// 認証: Vercel Cron が付ける Authorization: Bearer <CRON_SECRET>（他の cron と同じ）。
// 手動実行: curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/inzai-bunka-sync?dry=1"
//   ?dry=1 なら DB に書かず、何を insert/update するかだけ返す。
//
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//           INGEST_BOT_MEMBER_ID（取り込みイベントの organizer_id。COCoLa ingest と同じ bot）

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { INZAI_BUNKA_SOURCE } from '@/lib/inzai-bunka/calendar'
import { syncInzaiBunka, type EventRow, type ExistingEventRow, type OtherEventRow, type SyncDb, type SyncResult } from '@/lib/inzai-bunka/sync'

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

  const db: SyncDb = {
    async listExisting() {
      const { data, error } = await supabase
        .from('events')
        .select('id, external_source_id, title, description, start_at, end_at, location, fee, capacity, organizer_name_text, proxy_source_url, flyer_image_url')
        .eq('external_source', INZAI_BUNKA_SOURCE)
      if (error) throw new Error(`listExisting: ${error.message}`)
      return (data ?? []) as ExistingEventRow[]
    },
    async listOtherFutureEvents(fromDate: string) {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_at, location, organizer_name_text')
        .gte('start_at', `${fromDate}T00:00:00+09:00`)
        .or(`external_source.is.null,external_source.neq.${INZAI_BUNKA_SOURCE}`)
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
    async uploadFlyer(path, bytes, contentType) {
      const { error } = await supabase.storage
        .from('event-flyers')
        .upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' })
      if (error) {
        console.warn('[inzai-bunka-sync] flyer upload failed:', error.message)
        return null
      }
      return supabase.storage.from('event-flyers').getPublicUrl(path).data.publicUrl
    },
  }

  const dryRun = new URL(request.url).searchParams.get('dry') === '1'
  const startedAt = new Date()
  let result: SyncResult
  try {
    result = await syncInzaiBunka(db, {
      botMemberId,
      dryRun,
      log: (m) => console.warn('[inzai-bunka-sync]', m),
    })
  } catch (err) {
    // 一覧の取得失敗など、同期本体が例外で落ちた場合も「動いたが失敗」として記録を残す
    const message = err instanceof Error ? err.message : String(err)
    await recordRun(supabase, startedAt, {
      ok: false,
      fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
      inserted: [], updated: [], unchanged: 0, skipped: [], duplicates: [], errors: [message], dryRun,
    })
    console.error('[inzai-bunka-sync] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
  await recordRun(supabase, startedAt, result)
  console.log(
    `[inzai-bunka-sync] ${dryRun ? '(dry) ' : ''}list=${result.fetched.list} details=${result.fetched.details}/${result.fetched.detailFailed}fail calendar=${result.fetched.calendar} merged=${result.fetched.merged} future=${result.fetched.future} inserted=${result.inserted.length} updated=${result.updated.length} unchanged=${result.unchanged} duplicates=${result.duplicates.length} errors=${result.errors.length}`,
  )
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

/** 実行記録を event_sync_runs に1行残す（管理画面「イベント一括取り込み」で見る）。失敗しても同期結果は返す */
async function recordRun(supabase: SupabaseClient, startedAt: Date, r: SyncResult) {
  const { error } = await supabase.from('event_sync_runs').insert({
    source: INZAI_BUNKA_SOURCE,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    ok: r.ok,
    dry_run: r.dryRun,
    fetched: r.fetched,
    inserted: r.inserted.length,
    updated: r.updated.length,
    unchanged: r.unchanged,
    duplicates: r.duplicates.length,
    skipped: r.skipped.length,
    errors: r.errors,
    detail: { inserted: r.inserted, updated: r.updated, duplicates: r.duplicates, skipped: r.skipped },
  })
  if (error) console.error('[inzai-bunka-sync] recordRun failed:', error.message)
}
