// GET/POST /api/cron/event-reminder
// 参加登録したイベントの前日リマインド（ベル🔔＋Webプッシュ）。
//
// 毎朝（vercel.json、UTC 23:12 = 日本時間 8:12）、「あした始まる」公開中のイベントの
// 参加者（主催・スタッフ・参加すべて）へ「明日のイベント」を知らせる。
//
// - 設定で「イベント通知を受け取る」を外した人には送らない
// - 重複防止：link_url が `/events/<id>#remind-1d` の通知を持つ人には送らない（再実行しても安全）
// - 宛先は参加者だけ。会員の名前は通知にも応答にも載せない（件数だけ返す）
// - ?dryRun=1 なら通知を作らず、宛先の件数だけ返す
//
// 認証: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動付与）

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { notifyMembers } from '@/lib/notify'
import {
  buildEventReminder,
  nextJstDayWindow,
  pickReminderRecipients,
  reminderLink,
  type ReminderEvent,
  type ReminderMember,
} from '@/lib/event-reminder'

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

  const { fromIso, toIso } = nextJstDayWindow(new Date())

  const { data: events, error: eventsErr } = await admin
    .from('events')
    .select('id, title, start_at, location, online_flag')
    .eq('status', 'open')
    .gte('start_at', fromIso)
    .lt('start_at', toIso)
  if (eventsErr) return NextResponse.json({ error: 'events query failed' }, { status: 500 })
  const list = (events ?? []) as ReminderEvent[]
  if (list.length === 0) {
    return NextResponse.json({ window: { fromIso, toIso }, events: 0, sent: 0, note: 'nothing to remind' })
  }

  const eventIds = list.map((e) => e.id)
  const { data: parts, error: partsErr } = await admin
    .from('event_participants')
    .select('event_id, member_id')
    .in('event_id', eventIds)
  if (partsErr) return NextResponse.json({ error: 'participants query failed' }, { status: 500 })
  const participantsByEvent = new Map<string, string[]>()
  for (const p of (parts ?? []) as { event_id: string; member_id: string }[]) {
    const arr = participantsByEvent.get(p.event_id) ?? []
    arr.push(p.member_id)
    participantsByEvent.set(p.event_id, arr)
  }

  const memberIds = [...new Set((parts ?? []).map((p) => (p as { member_id: string }).member_id))]
  let members: ReminderMember[] = []
  if (memberIds.length > 0) {
    const { data: ms, error: msErr } = await admin
      .from('members')
      .select('id, contact_preferences')
      .in('id', memberIds)
      .is('deleted_at', null)
    if (msErr) return NextResponse.json({ error: 'members query failed' }, { status: 500 })
    members = (ms ?? []) as ReminderMember[]
  }

  const links = list.map((e) => reminderLink(e.id))
  const { data: sentRows, error: sentErr } = await admin
    .from('notifications')
    .select('recipient_id, link_url')
    .eq('kind', 'event')
    .in('link_url', links)
  if (sentErr) return NextResponse.json({ error: 'notifications query failed' }, { status: 500 })
  const sentByLink = new Map<string, Set<string>>()
  for (const r of (sentRows ?? []) as { recipient_id: string; link_url: string }[]) {
    const set = sentByLink.get(r.link_url) ?? new Set<string>()
    set.add(r.recipient_id)
    sentByLink.set(r.link_url, set)
  }

  let sent = 0
  let pushed = 0
  const perEvent: { eventId: string; recipients: number }[] = []
  for (const ev of list) {
    const reminder = buildEventReminder(ev)
    const recipientIds = pickReminderRecipients({
      participantIds: participantsByEvent.get(ev.id) ?? [],
      members,
      alreadyNotified: sentByLink.get(reminder.linkUrl) ?? new Set<string>(),
    })
    if (recipientIds.length === 0) continue
    if (dryRun) {
      perEvent.push({ eventId: ev.id, recipients: recipientIds.length })
      sent += recipientIds.length
      continue
    }
    const r = await notifyMembers({
      recipientIds,
      kind: 'event',
      title: reminder.title,
      body: reminder.body,
      linkUrl: reminder.linkUrl,
    })
    perEvent.push({ eventId: ev.id, recipients: r.recipients })
    sent += r.recipients
    pushed += r.pushed
  }

  return NextResponse.json({ window: { fromIso, toIso }, dryRun, events: list.length, sent, pushed, perEvent })
}
