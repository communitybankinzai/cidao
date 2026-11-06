// GET/POST /api/cron/event-digest
// 新着イベントの「毎日18時のまとめ」（ベル🔔＋Webプッシュ）。
//
// 毎日（vercel.json、UTC 9:00 = 日本時間 18:00）、前日18:00〜当日18:00に新しく載った公開中のイベントを、
// 設定で『毎日18時にまとめて』を選んだ会員へ1通で知らせる。
// 会員が登録した分も、外部から取り込んだ分（印西市カレンダー・Instagram・文化ホール等）も含む。
//
// - 『その都度』の人には登録の瞬間に出してあるので送らない。『受け取らない』の人にも送らない
// - すでに終わったイベント（開始が18:00より前）は載せない
// - 重複防止：link_url の末尾が `#digest-<日付>` の通知を持つ人には送らない（再実行しても安全）
// - 会員の名前は通知にも応答にも載せない（件数だけ返す）
// - ?dryRun=1 なら通知を作らず、件数だけ返す
//
// 認証: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動付与）

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { notifyMembers } from '@/lib/notify'
import {
  buildEventDigest,
  digestMarker,
  digestWindow,
  pickDigestRecipients,
  type DigestEvent,
  type DigestMember,
} from '@/lib/event-digest'

const EVENT_LIMIT = 300 // 1日に新しく載る件数の上限（取り込みが暴れても通知の処理が重くならないように）

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
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: 'service role not configured' }, { status: 503 })
  }
  const admin = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { fromIso, toIso, dateKey } = digestWindow(new Date())

  const { data: events, error: eventsErr } = await admin
    .from('events')
    .select('id, title, start_at, location, online_flag')
    .eq('status', 'open')
    .gte('created_at', fromIso)
    .lt('created_at', toIso)
    .gte('start_at', toIso)
    .order('start_at', { ascending: true })
    .limit(EVENT_LIMIT)
  if (eventsErr) return NextResponse.json({ error: 'events query failed' }, { status: 500 })
  const list = (events ?? []) as DigestEvent[]
  if (list.length === 0) {
    return NextResponse.json({ window: { fromIso, toIso }, events: 0, sent: 0, note: 'nothing new' })
  }

  const { data: ms, error: msErr } = await admin
    .from('members')
    .select('id, contact_preferences')
    .is('deleted_at', null)
  if (msErr) return NextResponse.json({ error: 'members query failed' }, { status: 500 })

  const { data: sentRows, error: sentErr } = await admin
    .from('notifications')
    .select('recipient_id')
    .eq('kind', 'event')
    .like('link_url', `%${digestMarker(dateKey)}`)
  if (sentErr) return NextResponse.json({ error: 'notifications query failed' }, { status: 500 })
  const alreadyNotified = new Set(((sentRows ?? []) as { recipient_id: string }[]).map((r) => r.recipient_id))

  const recipientIds = pickDigestRecipients({ members: (ms ?? []) as DigestMember[], alreadyNotified })
  const digest = buildEventDigest(list, dateKey)

  if (recipientIds.length === 0) {
    return NextResponse.json({ window: { fromIso, toIso }, dryRun, events: list.length, sent: 0, note: 'no recipients' })
  }
  if (dryRun) {
    return NextResponse.json({
      window: { fromIso, toIso },
      dryRun,
      events: list.length,
      sent: recipientIds.length,
      title: digest.title,
    })
  }

  const r = await notifyMembers({
    recipientIds,
    kind: 'event',
    title: digest.title,
    body: digest.body,
    linkUrl: digest.linkUrl,
  })
  return NextResponse.json({
    window: { fromIso, toIso },
    dryRun,
    events: list.length,
    sent: r.recipients,
    pushed: r.pushed,
    title: digest.title,
  })
}
