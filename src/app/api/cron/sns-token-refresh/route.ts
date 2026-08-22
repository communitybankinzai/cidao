// GET/POST /api/cron/sns-token-refresh
// Threads / Instagram の長期アクセストークン（60日で失効）を毎週リフレッシュして延長する。
//
// 背景: COCoLa 時代の Threads 自動投稿はトークンをリフレッシュしない構成だったため
//       60日で黙って失効するリスクを抱えていた。CiDAO ではトークンを
//       app_settings（sns_threads_auth / sns_instagram_auth）に保管し、この cron が定期更新する。
//
// 仕様:
//   Threads   : GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=<現>
//   Instagram : GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<現>
//   いずれも発行から24時間以上経過した未失効トークンのみリフレッシュ可能。
//   返ってきた新トークンは再び60日有効。週次実行なら十分間に合う。
//
// 環境変数: CRON_SECRET / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// 自動延長できないトークン（EXPIRY_WATCH）:
//   Instagram検索用（sns_instagram_discovery_auth）は Facebook Login 方式のため、
//   ig_refresh_token は使えず、fb_exchange_token は API 成功しても有効期限が延びない
//   （2026-08-22 実測: 交換後も expires_at が元と同一）。cron へ入れると
//   「毎週延長成功」に見えて実際は失効するため、延長せず期限監視のみ行う。

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

const TARGETS = [
  { key: 'sns_threads_auth', endpoint: 'https://graph.threads.net/refresh_access_token', grant: 'th_refresh_token' },
  // 検索専用アプリのトークン（災害SNS巡回のThreads枠）。投稿用とは別アプリ・別トークン
  { key: 'sns_threads_discovery_auth', endpoint: 'https://graph.threads.net/refresh_access_token', grant: 'th_refresh_token' },
  { key: 'sns_instagram_auth', endpoint: 'https://graph.instagram.com/refresh_access_token', grant: 'ig_refresh_token' },
] as const

type AuthValue = { user_id?: string; access_token?: string; username?: string; saved_at?: string }

async function refreshOne(
  supabase: SupabaseClient,
  target: (typeof TARGETS)[number],
): Promise<{ key: string; status: string; detail?: string }> {
  const { data: row } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', target.key)
    .maybeSingle()

  const auth = row?.value as AuthValue | null
  if (!auth?.access_token) {
    return { key: target.key, status: 'skipped', detail: 'not set' }
  }

  // 発行から24時間未満はリフレッシュ不可の仕様。保存直後の週は skip される
  const savedAt = auth.saved_at ? new Date(auth.saved_at).getTime() : 0
  if (Date.now() - savedAt < 86400_000) {
    return { key: target.key, status: 'skipped', detail: 'token younger than 24h' }
  }

  const r = await fetch(
    `${target.endpoint}?grant_type=${target.grant}&access_token=${encodeURIComponent(auth.access_token)}`,
  )
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    // 失効済みなど。管理画面で再設定してもらうしかないので、状態は変えずエラーだけ返す
    return { key: target.key, status: 'failed', detail: JSON.stringify(j?.error?.message ?? j).slice(0, 300) }
  }

  const expiresInSec = typeof j.expires_in === 'number' ? j.expires_in : 60 * 86400
  const { error } = await supabase.from('app_settings').upsert({
    key: target.key,
    value: {
      ...auth,
      access_token: String(j.access_token),
      saved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    },
    updated_at: new Date().toISOString(),
  })
  if (error) return { key: target.key, status: 'failed', detail: error.message }

  return { key: target.key, status: 'refreshed', detail: `@${auth.username ?? '?'} +${Math.round(expiresInSec / 86400)}d` }
}

// 自動延長できないトークンの期限監視。
// このcronは週1回（月曜22:30）しか動かないため、「残り日数がちょうどN日」で判定すると
// 節目の日に実行日が当たらず通知が一度も飛ばない。残り日数が閾値を下回った最初の実行で
// 送り、送った閾値を記録して重複を防ぐ方式にする。
const EXPIRY_ALERT_THRESHOLDS = [30, 14, 7, 3, 1]

const EXPIRY_WATCH = [
  {
    key: 'sns_instagram_discovery_auth',
    label: 'Instagram検索用トークン（災害MAPのハッシュタグ巡回）',
    howTo: 'Graph API Explorer（アプリ=スレッズ自動投稿・User Token・pages_show_list/instagram_basic）でトークンを発行し、アクセストークンデバッガーの「アクセストークンを延長」で60日にしてから、CiDAO /admin/sns の「Instagram公開ハッシュタグ検索」へ貼り直す。',
  },
] as const

async function notifyExpiring(supabase: SupabaseClient) {
  const notices: Array<{ key: string; daysLeft: number; sent: boolean }> = []
  for (const target of EXPIRY_WATCH) {
    const { data: row } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', target.key)
      .maybeSingle()
    const auth = row?.value as { expires_at?: string; username?: string } | null
    if (!auth?.expires_at) continue

    const expiresAt = new Date(auth.expires_at).getTime()
    if (!Number.isFinite(expiresAt)) continue
    const daysLeft = Math.floor((expiresAt - Date.now()) / 86400_000)

    // 残り日数が下回っている閾値のうち「最も小さいもの」を選ぶ。
    // 最大側を選ぶと、残り26日でも常に閾値30が選ばれ続け、以降の段階へ進めない
    const threshold = EXPIRY_ALERT_THRESHOLDS.filter((t) => daysLeft <= t).sort((a, b) => a - b)[0]
    if (threshold === undefined) {
      notices.push({ key: target.key, daysLeft, sent: false })
      continue
    }
    // 同じ閾値で二重に送らない（トークンを更新すると alerted_threshold は消える）
    const alerted = (row?.value as { alerted_threshold?: number } | null)?.alerted_threshold
    if (typeof alerted === 'number' && alerted <= threshold) {
      notices.push({ key: target.key, daysLeft, sent: false })
      continue
    }

    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    const to = process.env.ADMIN_NOTIFY_EMAIL ?? 'communitybankinzai@gmail.com'
    if (!apiKey || !from) {
      notices.push({ key: target.key, daysLeft, sent: false })
      continue
    }
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(apiKey)
      const when = new Date(expiresAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
      await resend.emails.send({
        from,
        to,
        subject: `【CiDAO】${target.label}があと${daysLeft}日で失効します`,
        text:
          `${target.label}の有効期限が近づいています。

` +
          `失効予定日: ${when}（あと${daysLeft}日）
` +
          `対象設定キー: ${target.key}

` +
          `このトークンは仕様上、自動延長できません（fb_exchange_token を使っても有効期限が延びないことを2026-08-22に実測で確認済み）。手動で再発行してください。

` +
          `再発行手順:
${target.howTo}

` +
          `失効すると災害MAPのInstagram巡回が止まります（エラーにはならず候補が0件になるだけなので気づきにくい）。`,
      })
      await supabase.from('app_settings').upsert({
        key: target.key,
        value: { ...(row?.value as Record<string, unknown>), alerted_threshold: threshold },
        updated_at: new Date().toISOString(),
      })
      notices.push({ key: target.key, daysLeft, sent: true })
    } catch {
      notices.push({ key: target.key, daysLeft, sent: false })
    }
  }
  return notices
}

async function handle(request: Request) {
  // Vercel は CRON_SECRET があると Authorization: Bearer <CRON_SECRET> を自動付与する
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: 'supabase credentials not configured' }, { status: 503 })
  }
  const supabase = createSupabaseClient(supaUrl, serviceKey, { auth: { persistSession: false } })

  const results = []
  for (const target of TARGETS) {
    results.push(await refreshOne(supabase, target))
  }

  // 自動延長できないトークンは、期限が近づいたら通知だけ行う
  const expiring = await notifyExpiring(supabase)

  const failed = results.some((r) => r.status === 'failed')
  return NextResponse.json({ results, expiring }, { status: failed ? 502 : 200 })
}

export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
