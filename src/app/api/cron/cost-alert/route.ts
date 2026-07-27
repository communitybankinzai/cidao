// GET/POST /api/cron/cost-alert
// Anthropic のクレジット残高とAPIキー有効期限を監視し、枯渇・失効の「前に」メール警告する。
//
// 背景: 2026-07-27 に残高が -$0.24 に落ちて組織のAPIアクセスが停止し、
//       CiDAO の AI 機能（チラシ抽出・提案分類・団体マッチング）が全停止した。
//       残高切れは 401「API key is invalid」として表れるため原因特定が遅れる。
//
// 残高の求め方:
//   Anthropic には残高を返す API が無い（Cost API は「使った額」のみ）。
//   そのため「基準額 − 基準日以降の累計コスト」で算出する。
//   チャージしたら CREDIT_BASELINE_USD / CREDIT_BASELINE_AT を更新すること。
//
// 注意: Cost API の amount は「セント」建ての文字列（実測で Console のキー別コストと一致）。
//
// 環境変数:
//   ANTHROPIC_ADMIN_KEY        : 管理者キー（sk-ant-admin01-...）。組織全体を操作できるため取扱注意
//   CREDIT_BASELINE_USD        : 最後にチャージした直後の残高（USD）
//   CREDIT_BASELINE_AT         : その時刻（ISO8601, 例 2026-07-27T12:00:00Z）
//   CREDIT_ALERT_THRESHOLD_USD : 残高警告の閾値（既定 5）
//   KEY_EXPIRY_ALERT_DAYS      : キー失効警告の日数（既定 30）
//   COST_ALERT_TO              : 宛先メールアドレス
//   RESEND_API_KEY / MAIL_FROM : 送信設定（未設定なら送信せず skipped）
//   CRON_SECRET                : Vercel Cron が Authorization: Bearer で自動付与

import { NextResponse } from 'next/server'
import { normalizeMailFrom } from '@/lib/mail'

const API_BASE = 'https://api.anthropic.com/v1/organizations'
const CENTS_PER_USD = 100

type CostItem = { amount?: string }
type CostBucket = { results?: CostItem[] }
type ApiKey = { id: string; name?: string; status?: string; expires_at?: string | null }

function adminHeaders(key: string) {
  return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
}

const DAY_MS = 86400_000

// 基準日から現在までの累計コスト（USD）。
//
// cost_report の制約（実測で確認・2026-07-27）:
//   - starting_at に「当日（UTC）」を指定すると 400 が返る。当日分の集計はまだ提供されない
//   - 1d バケットは1回のリクエストで最大31件
// そのため starting_at は前日以前に丸め、31日ずつ分割して取得する。
// 当日分は集計に含まれない＝最大1日ぶん少なく出るが、残高を少なめに見積もる方向なので
// 警告用途としては安全側に倒れる。
async function fetchCostSince(adminKey: string, since: Date): Promise<number> {
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  // starting_at の上限は「前日」
  let cursor = Math.min(since.getTime(), todayUtc - DAY_MS)
  let cents = 0

  for (let guard = 0; guard < 24 && cursor < todayUtc; guard++) {
    const end = Math.min(cursor + 31 * DAY_MS, todayUtc + DAY_MS)
    const qs = new URLSearchParams({
      starting_at: new Date(cursor).toISOString(),
      ending_at: new Date(end).toISOString(),
      limit: '31',
    })
    const res = await fetch(`${API_BASE}/cost_report?${qs}`, { headers: adminHeaders(adminKey) })
    if (!res.ok) throw new Error(`cost_report ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as { data?: CostBucket[] }
    for (const bucket of json.data ?? []) {
      for (const item of bucket.results ?? []) cents += Number(item.amount ?? 0)
    }
    cursor = end
  }
  return cents / CENTS_PER_USD
}

// 失効が近い（または失効済みの）APIキーを返す
async function fetchExpiringKeys(adminKey: string, withinDays: number): Promise<ApiKey[]> {
  const res = await fetch(`${API_BASE}/api_keys?limit=100`, { headers: adminHeaders(adminKey) })
  if (!res.ok) throw new Error(`api_keys ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { data?: ApiKey[] }
  const limit = Date.now() + withinDays * 86400_000
  return (json.data ?? []).filter(
    (k) => k.status !== 'inactive' && k.expires_at && new Date(k.expires_at).getTime() <= limit,
  )
}

async function sendAlert(subject: string, lines: string[]): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.MAIL_FROM ?? ''
  const to = process.env.COST_ALERT_TO ?? ''
  if (!apiKey || !from || !to) return 'skipped: RESEND_API_KEY / MAIL_FROM / COST_ALERT_TO not configured'

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: normalizeMailFrom(from),
    to,
    subject,
    html:
      `<p>${lines.join('</p><p>')}</p>` +
      '<p style="color:#666;font-size:12px">Anthropic Console: ' +
      '<a href="https://platform.claude.com/settings/billing">残高の確認・追加</a></p>',
  })
  return error ? `send failed: ${error.message}` : 'sent'
}

export async function GET() {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY ?? ''
  if (!adminKey) {
    return NextResponse.json({ skipped: 'ANTHROPIC_ADMIN_KEY not configured' })
  }

  const baselineUsd = Number(process.env.CREDIT_BASELINE_USD ?? '')
  const baselineAt = process.env.CREDIT_BASELINE_AT ?? ''
  const threshold = Number(process.env.CREDIT_ALERT_THRESHOLD_USD ?? '5')
  const expiryDays = Number(process.env.KEY_EXPIRY_ALERT_DAYS ?? '30')

  const alerts: string[] = []
  let remaining: number | null = null
  let spent: number | null = null

  // 1. 残高
  if (Number.isFinite(baselineUsd) && baselineAt) {
    try {
      spent = await fetchCostSince(adminKey, new Date(baselineAt))
      remaining = baselineUsd - spent
      if (remaining < threshold) {
        alerts.push(
          `<strong>Anthropic のクレジット残高が少なくなっています。</strong>`,
          `推定残高: <strong>$${remaining.toFixed(2)}</strong>（警告ライン $${threshold.toFixed(2)}）`,
          `基準額 $${baselineUsd.toFixed(2)}（${baselineAt}）から $${spent.toFixed(2)} を消費しました。`,
          '残高が尽きると CiDAO のチラシAI抽出・提案分類・団体マッチングがすべて停止します。',
        )
      }
    } catch (e) {
      console.error('[cron/cost-alert] cost fetch failed:', e instanceof Error ? e.message : e)
      alerts.push(`クレジット残高の取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 2. APIキーの有効期限
  let expiring: ApiKey[] = []
  try {
    expiring = await fetchExpiringKeys(adminKey, expiryDays)
    if (expiring.length > 0) {
      alerts.push('<strong>有効期限が近いAPIキーがあります。</strong>')
      for (const k of expiring) {
        const days = Math.ceil((new Date(k.expires_at!).getTime() - Date.now()) / 86400_000)
        alerts.push(
          `${k.name ?? k.id}: ${days < 0 ? '失効済み' : `あと ${days} 日`}（${k.expires_at}）`,
        )
      }
    }
  } catch (e) {
    console.error('[cron/cost-alert] api_keys fetch failed:', e instanceof Error ? e.message : e)
  }

  let mail = 'not needed'
  if (alerts.length > 0) {
    mail = await sendAlert('【CiDAO】Anthropic の残高・キー期限の警告', alerts)
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    baseline_usd: Number.isFinite(baselineUsd) ? baselineUsd : null,
    baseline_at: baselineAt || null,
    spent_usd: spent === null ? null : Number(spent.toFixed(4)),
    remaining_usd: remaining === null ? null : Number(remaining.toFixed(2)),
    threshold_usd: threshold,
    expiring_keys: expiring.map((k) => ({ name: k.name, expires_at: k.expires_at })),
    alerted: alerts.length > 0,
    mail,
  })
}

export const POST = GET
