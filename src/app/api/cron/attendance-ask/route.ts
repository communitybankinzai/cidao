// GET/POST /api/cron/attendance-ask
// 開催が終わった「子どもの居場所」の催しで、参加者数がまだ空のものについて、イベントを登録した人へ
// 「参加者数を教えてください」とベル🔔＋Webプッシュで知らせる（1人に1通へまとめる）。
//
// 毎日（vercel.json、UTC 1:30 = 日本時間 10:30）。
//
// - 対象：目印（child_place）があり、参加者数が空で、終わって6時間〜7日の催し（src/lib/attendance-ask.ts）
// - 宛先：個人主催は登録した本人、団体主催は代表・役員、写真投稿者。外部から取り込んだ催しと『主催者不明』は対象外
// - 同じ催しには1回だけ：通知できたら events.attendee_asked_at に時刻を入れる（再実行しても重複しない）
// - 設定で「イベント通知を受け取る」を外した人には送らない
// - 会員の名前は通知にも応答にも載せない（件数だけ返す）
// - ?dryRun=1 なら通知も記録も作らず、件数だけ返す
//
// 認証: Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動付与）

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { notifyMembers } from '@/lib/notify'
import { askWindow, buildAskNotification, groupAskByRecipient, type AskEvent, type AskMember } from '@/lib/attendance-ask'

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
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: 'service role not configured' }, { status: 503 })
  }
  const botMemberId = process.env.INGEST_BOT_MEMBER_ID ?? ''
  const admin = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = new Date()
  const { fromIso, toIso } = askWindow(now)

  const { data: events, error: eventsErr } = await admin
    .from('events')
    .select('id, title, end_at, organizer_type, organizer_id, organizer_name_text, external_source, submitter_member_id')
    .eq('status', 'open')
    .not('child_place', 'is', null)
    .is('attendee_count', null)
    .is('attendee_asked_at', null)
    .gte('end_at', fromIso)
    .lte('end_at', toIso)
    .order('end_at', { ascending: true })
    .limit(500)
  if (eventsErr) return NextResponse.json({ error: 'events query failed' }, { status: 500 })
  const list = (events ?? []) as AskEvent[]
  if (list.length === 0) {
    return NextResponse.json({ window: { fromIso, toIso }, events: 0, recipients: 0, sent: 0, note: 'nothing to ask' })
  }

  // 団体主催の催しの代表・役員
  const orgIds = [...new Set(list.filter((e) => e.organizer_type === 'org').map((e) => e.organizer_id))]
  const officersByOrg: Record<string, string[]> = {}
  if (orgIds.length > 0) {
    const { data: mem, error: memErr } = await admin
      .from('memberships')
      .select('org_id, member_id')
      .in('org_id', orgIds)
      .eq('status', 'confirmed')
      .in('role', ['representative', 'officer'])
      .is('left_at', null)
    if (memErr) return NextResponse.json({ error: 'memberships query failed' }, { status: 500 })
    for (const m of (mem ?? []) as { org_id: string; member_id: string }[]) {
      ;(officersByOrg[m.org_id] ??= []).push(m.member_id)
    }
  }

  // 聞く相手の候補（在籍している人だけ）
  const candidateIds = new Set<string>()
  for (const e of list) {
    if (e.organizer_type === 'member') candidateIds.add(e.organizer_id)
    if (e.submitter_member_id) candidateIds.add(e.submitter_member_id)
  }
  for (const ids of Object.values(officersByOrg)) for (const id of ids) candidateIds.add(id)
  let members: AskMember[] = []
  if (candidateIds.size > 0) {
    const { data: ms, error: msErr } = await admin
      .from('members')
      .select('id, contact_preferences')
      .in('id', [...candidateIds])
      .is('deleted_at', null)
    if (msErr) return NextResponse.json({ error: 'members query failed' }, { status: 500 })
    members = (ms ?? []) as AskMember[]
  }

  const grouped = groupAskByRecipient(list, officersByOrg, botMemberId, members)

  let sent = 0
  let pushed = 0
  const askedEventIds = new Set<string>()
  for (const [memberId, evs] of grouped) {
    const n = buildAskNotification(evs.map((e) => e.title))
    if (dryRun) {
      sent++
      for (const e of evs) askedEventIds.add(e.id)
      continue
    }
    const r = await notifyMembers({ recipientIds: [memberId], kind: 'event', title: n.title, body: n.body, linkUrl: n.linkUrl })
    if (r.recipients > 0) {
      sent++
      pushed += r.pushed
      for (const e of evs) askedEventIds.add(e.id)
    }
  }

  let marked = 0
  if (!dryRun && askedEventIds.size > 0) {
    const { data: upd, error: updErr } = await admin
      .from('events')
      .update({ attendee_asked_at: now.toISOString() })
      .in('id', [...askedEventIds])
      .select('id')
    if (updErr) return NextResponse.json({ error: 'mark failed', sent }, { status: 500 })
    marked = (upd ?? []).length
  }

  return NextResponse.json({
    window: { fromIso, toIso },
    dryRun,
    events: list.length,
    recipients: grouped.size,
    sent,
    pushed,
    marked,
    notAskable: list.length - askedEventIds.size, // 聞く相手がいない（取り込み・主催者不明など）か、通知できなかった催し
  })
}
