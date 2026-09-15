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
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { INZAI_BUNKA_SOURCE } from '@/lib/inzai-bunka/calendar'
import { syncInzaiBunka, type EventRow, type ExistingEventRow, type OtherEventRow, type SyncDb } from '@/lib/inzai-bunka/sync'

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
  const result = await syncInzaiBunka(db, {
    botMemberId,
    dryRun,
    log: (m) => console.warn('[inzai-bunka-sync]', m),
  })
  console.log(
    `[inzai-bunka-sync] ${dryRun ? '(dry) ' : ''}list=${result.fetched.list} details=${result.fetched.details}/${result.fetched.detailFailed}fail calendar=${result.fetched.calendar} merged=${result.fetched.merged} future=${result.fetched.future} inserted=${result.inserted.length} updated=${result.updated.length} unchanged=${result.unchanged} duplicates=${result.duplicates.length} errors=${result.errors.length}`,
  )
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
