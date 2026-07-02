// GET/POST /api/cron/notify
// 提案ライフサイクルのメール通知（Step 11d: Resend 本実装）
//
// 3種類の通知を送る:
//   voting_started : 投票が始まった提案（voting_start_at が直近3日以内）
//   deadline_24h   : 締切まで36時間以内の投票中提案（日次実行でも取りこぼさない窓）
//   finalized      : 結果が確定した提案（voting_end_at が直近3日以内）
//
// 重複防止: notification_log の unique(proposal_id, kind)。何度呼んでも安全（冪等）。
// 起動: Vercel Cron（vercel.json、毎日 23:07 UTC = JST 8:07）。
//        Vercel は CRON_SECRET 環境変数があると Authorization: Bearer <CRON_SECRET>
//        を自動付与するので、手動テストも同じヘッダで叩ける。
// 宛先: tier が email_only / verified の未退会メンバー。
//        contact_preferences.proposal_email === false のメンバーは除外（オプトアウト）。
// フォールバック: RESEND_API_KEY / MAIL_FROM 未設定なら送信もログ記録もせず
//        skipped を返す（キー設定後の初回実行時に、直近3日窓の分だけ送られる）。
//
// 環境変数: CRON_SECRET / RESEND_API_KEY / MAIL_FROM /
//           NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const SITE_URL = 'https://cidao.vercel.app'
const WINDOW_HOURS = 72 // voting_started / finalized の遡り窓（初回・障害復帰時の大量送信防止）
const DEADLINE_WINDOW_HOURS = 36 // 日次実行でも締切前リマインダーを取りこぼさない窓

type Kind = 'voting_started' | 'deadline_24h' | 'finalized'

type Proposal = {
  id: string
  title: string
  binding_type: string
  budget_size: string | null
  status: string
  voting_start_at: string | null
  voting_end_at: string | null
}

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

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: 'service role not configured' }, { status: 503 })
  }
  const admin = createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = Date.now()
  const windowStart = new Date(now - WINDOW_HOURS * 3600_000).toISOString()
  const nowIso = new Date(now).toISOString()
  const deadlineEnd = new Date(now + DEADLINE_WINDOW_HOURS * 3600_000).toISOString()

  // 通知対象の提案を3種類分収集
  const [started, deadline, finalized, logRows] = await Promise.all([
    admin
      .from('proposals')
      .select('id, title, binding_type, budget_size, status, voting_start_at, voting_end_at')
      .eq('status', 'voting')
      .gte('voting_start_at', windowStart),
    admin
      .from('proposals')
      .select('id, title, binding_type, budget_size, status, voting_start_at, voting_end_at')
      .eq('status', 'voting')
      .gt('voting_end_at', nowIso)
      .lte('voting_end_at', deadlineEnd),
    admin
      .from('proposals')
      .select('id, title, binding_type, budget_size, status, voting_start_at, voting_end_at')
      .in('status', ['passed', 'rejected', 'closed'])
      .gte('voting_end_at', windowStart)
      .lte('voting_end_at', nowIso),
    admin.from('notification_log').select('proposal_id, kind'),
  ])

  const queryError = started.error ?? deadline.error ?? finalized.error ?? logRows.error
  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  const alreadySent = new Set(
    (logRows.data ?? []).map((r) => `${r.proposal_id}:${r.kind}`),
  )
  const due: Array<{ proposal: Proposal; kind: Kind }> = []
  for (const p of (started.data ?? []) as Proposal[]) {
    if (!alreadySent.has(`${p.id}:voting_started`)) due.push({ proposal: p, kind: 'voting_started' })
  }
  for (const p of (deadline.data ?? []) as Proposal[]) {
    if (!alreadySent.has(`${p.id}:deadline_24h`)) due.push({ proposal: p, kind: 'deadline_24h' })
  }
  for (const p of (finalized.data ?? []) as Proposal[]) {
    if (!alreadySent.has(`${p.id}:finalized`)) due.push({ proposal: p, kind: 'finalized' })
  }

  if (due.length === 0) {
    return NextResponse.json({ due: 0, sent: 0, note: 'nothing to notify' })
  }

  // 宛先メンバー（通常メンバー以上・未退会・オプトアウトしていない）
  const { data: members, error: memberErr } = await admin
    .from('members')
    .select('id, display_name, contact_preferences')
    .in('tier', ['email_only', 'verified'])
    .is('deleted_at', null)
  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 })
  }
  const recipientIds = (members ?? [])
    .filter((m) => {
      const prefs = (m.contact_preferences ?? {}) as Record<string, unknown>
      return prefs.proposal_email !== false
    })
    .map((m) => m.id)

  // auth.users からメールアドレスを取得（id → email）
  const emailById = new Map<string, string>()
  let page = 1
  for (;;) {
    const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (listErr) {
      return NextResponse.json({ error: `listUsers failed: ${listErr.message}` }, { status: 500 })
    }
    for (const u of usersPage.users) {
      if (u.email) emailById.set(u.id, u.email)
    }
    if (usersPage.users.length < 1000) break
    page += 1
  }
  const recipients = recipientIds
    .map((id) => emailById.get(id))
    .filter((e): e is string => !!e)

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      due: due.map((d) => ({ kind: d.kind, proposal_id: d.proposal.id, title: d.proposal.title })),
      recipients: recipients.length,
    })
  }

  const apiKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.MAIL_FROM ?? ''
  if (!apiKey || !from) {
    return NextResponse.json({
      skipped: 'RESEND_API_KEY or MAIL_FROM not configured',
      due: due.length,
      recipients: recipients.length,
    })
  }
  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const results: Array<{ proposal_id: string; kind: Kind; sent: number; errors: number }> = []

  for (const { proposal, kind } of due) {
    const { subject, text } = composeEmail(proposal, kind)
    let sent = 0
    let errors = 0

    // Resend batch API は 1 回につき最大 100 通
    for (let i = 0; i < recipients.length; i += 100) {
      const chunk = recipients.slice(i, i + 100)
      try {
        const { error: sendErr } = await resend.batch.send(
          chunk.map((to) => ({ from, to, subject, text })),
        )
        if (sendErr) {
          errors += chunk.length
        } else {
          sent += chunk.length
        }
      } catch {
        errors += chunk.length
      }
    }

    // 冪等性の担保: unique(proposal_id, kind) なので競合時は 23505 で握りつぶす
    const { error: logErr } = await admin.from('notification_log').insert({
      proposal_id: proposal.id,
      kind,
      recipients_count: sent,
      errors_count: errors,
      detail: { title: proposal.title, binding_type: proposal.binding_type },
    })
    if (logErr && !logErr.message.includes('duplicate')) {
      console.error('[cron/notify] log insert failed:', logErr.message)
    }
    results.push({ proposal_id: proposal.id, kind, sent, errors })
  }

  return NextResponse.json({
    due: due.length,
    recipients: recipients.length,
    results,
  })
}

function composeEmail(p: Proposal, kind: Kind): { subject: string; text: string } {
  const url = `${SITE_URL}/proposals/${p.id}`
  const isBinding = p.binding_type !== 'external'
  const choices = isBinding ? '賛成 / 反対 / 保留' : '協力できる / 難しい / わからない'
  const endAt = p.voting_end_at ? formatJst(p.voting_end_at) : '未定'

  const footer = [
    '',
    '─────────────────────────────',
    '※ このメールは CiDAO の提案・投票機能による自動通知です。',
    `※ 通知を停止するには、プロフィール編集（${SITE_URL}/me/edit）で`,
    '  「提案・投票のメール通知を受け取る」のチェックを外してください。',
    '',
    'Community Bank INZAI (CBI) / CiDAO',
  ]

  if (kind === 'voting_started') {
    return {
      subject: `【CiDAO】投票が始まりました：「${p.title}」`,
      text: [
        '議論期間が終わり、次の提案の投票が始まりました。',
        '',
        `■ 提案: ${p.title}`,
        `■ 投票の選択肢: ${choices}`,
        `■ 投票締切: ${endAt}`,
        '',
        `投票はこちら: ${url}`,
        ...footer,
      ].join('\n'),
    }
  }
  if (kind === 'deadline_24h') {
    return {
      subject: `【CiDAO】まもなく締切：「${p.title}」の投票`,
      text: [
        '投票中の提案が、まもなく締め切られます。まだの方はぜひご参加ください。',
        '',
        `■ 提案: ${p.title}`,
        `■ 投票締切: ${endAt}`,
        '',
        `投票はこちら: ${url}`,
        ...footer,
      ].join('\n'),
    }
  }
  const resultLabel =
    p.status === 'passed' ? '可決されました'
    : p.status === 'rejected' ? '否決されました'
    : '締め切られました（結果は提案ページをご覧ください）'
  return {
    subject: `【CiDAO】結果のお知らせ：「${p.title}」`,
    text: [
      `投票が終了し、提案「${p.title}」は${resultLabel}。`,
      '',
      `結果の詳細: ${url}`,
      ...footer,
    ].join('\n'),
  }
}

function formatJst(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + '（日本時間）'
}
