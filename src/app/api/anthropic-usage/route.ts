import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

// CBI管理画面（site/admin/ の「API・クラウド利用状況」タブ）に出す Anthropic API の利用状況。
//
// 返すもの（2026-10-04 事業主決定「CBI分だけ」）:
//   - 共有クレジットの推定残高（組織全体の消費から求める。補充したら CREDIT_BASELINE_* を更新すること）
//   - CBI のキー（名前が cidao で始まるもの）の直近30日のトークン数と、費用の按分推定
//   - CBI のキーの失効日
// N's factory のキー名・キー別の費用・組織全体の費用は返さない。
//
// 費用の按分: cost_report は APIキー別に分けられないため、「モデル×トークン種別」ごとの組織全体の費用を、
//   usage_report のそのトークン数のうち CBI のキーが占める割合で按分する（推定）。
//
// 認証: 管理画面のログインパスワード（CBI_ADMIN_PASSWORD）。metaverse-settings と同じ方式。
// 環境変数: ANTHROPIC_ADMIN_KEY / CREDIT_BASELINE_USD / CREDIT_BASELINE_AT（cost-alert と共用）

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

const API_BASE = 'https://api.anthropic.com/v1/organizations'
const DAY_MS = 86400_000
const CBI_KEY_PREFIX = 'cidao'
const CACHE_MS = 5 * 60_000

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

function passwordMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

type CostItem = { amount?: string; model?: string | null; token_type?: string | null }
type CostBucket = { starting_at: string; results?: CostItem[] }
type UsageItem = {
  api_key_id?: string | null
  model?: string | null
  uncached_input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
}
type UsageBucket = { starting_at: string; results?: UsageItem[] }
type ApiKey = { id: string; name?: string; status?: string; expires_at?: string | null }

function adminHeaders(key: string) {
  return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
}

async function getJson<T>(adminKey: string, path: string, qs: URLSearchParams): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}?${qs}`, { headers: adminHeaders(adminKey) })
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 160)}`)
  return (await res.json()) as T
}

// 1d バケットは1回で最大31件。starting_at に当日（UTC）は指定できない。
async function fetchBuckets<T extends { starting_at: string }>(
  adminKey: string,
  path: string,
  extra: [string, string][],
  from: number,
  todayUtc: number,
): Promise<T[]> {
  const out: T[] = []
  let cursor = Math.min(from, todayUtc - DAY_MS)
  for (let guard = 0; guard < 24 && cursor < todayUtc; guard++) {
    const end = Math.min(cursor + 31 * DAY_MS, todayUtc + DAY_MS)
    const qs = new URLSearchParams({
      starting_at: new Date(cursor).toISOString(),
      ending_at: new Date(end).toISOString(),
      limit: '31',
    })
    for (const [k, v] of extra) qs.append(k, v)
    const json = await getJson<{ data?: T[] }>(adminKey, path, qs)
    out.push(...(json.data ?? []))
    cursor = end
  }
  return out
}

function tokenParts(u: UsageItem): Record<string, number> {
  return {
    uncached_input_tokens: u.uncached_input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    'cache_creation.ephemeral_5m_input_tokens': u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    'cache_creation.ephemeral_1h_input_tokens': u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  }
}

async function build(adminKey: string) {
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const since30 = todayUtc - 30 * DAY_MS
  const baselineUsd = Number(process.env.CREDIT_BASELINE_USD ?? '')
  const baselineAt = process.env.CREDIT_BASELINE_AT ?? ''
  const baselineMs = baselineAt ? new Date(baselineAt).getTime() : NaN
  const hasBaseline = Number.isFinite(baselineUsd) && Number.isFinite(baselineMs)

  const [keysRes, costBuckets, usageBuckets] = await Promise.all([
    getJson<{ data?: ApiKey[] }>(adminKey, 'api_keys', new URLSearchParams({ limit: '100' })),
    fetchBuckets<CostBucket>(
      adminKey,
      'cost_report',
      [['group_by[]', 'description']],
      hasBaseline ? Math.min(baselineMs, since30) : since30,
      todayUtc,
    ),
    fetchBuckets<UsageBucket>(
      adminKey,
      'usage_report/messages',
      [
        ['bucket_width', '1d'],
        ['group_by[]', 'api_key_id'],
        ['group_by[]', 'model'],
      ],
      hasBaseline ? Math.min(baselineMs, since30) : since30,
      todayUtc,
    ),
  ])

  const keys = keysRes.data ?? []
  const cbiKeys = keys.filter((k) => (k.name ?? '').startsWith(CBI_KEY_PREFIX))
  const cbiIds = new Set(cbiKeys.map((k) => k.id))

  // 日 × モデル × トークン種別 の「組織全体」と「CBI」のトークン数
  const total = new Map<string, number>()
  const cbi = new Map<string, number>()
  const cbiTokensByKey = new Map<string, number>()
  for (const b of usageBuckets) {
    const date = b.starting_at.slice(0, 10)
    for (const u of b.results ?? []) {
      const parts = tokenParts(u)
      const isCbi = !!u.api_key_id && cbiIds.has(u.api_key_id)
      for (const [type, n] of Object.entries(parts)) {
        const k = `${date}|${u.model}|${type}`
        total.set(k, (total.get(k) ?? 0) + n)
        if (isCbi) cbi.set(k, (cbi.get(k) ?? 0) + n)
      }
      if (isCbi) {
        const sum = Object.values(parts).reduce((a, c) => a + c, 0)
        cbiTokensByKey.set(u.api_key_id!, (cbiTokensByKey.get(u.api_key_id!) ?? 0) + sum)
      }
    }
  }

  let spentSinceBaseline = 0
  const daily = new Map<string, number>()
  const byModel = new Map<string, number>()
  for (const b of costBuckets) {
    const date = b.starting_at.slice(0, 10)
    const bucketMs = new Date(b.starting_at).getTime()
    for (const c of b.results ?? []) {
      const usd = Number(c.amount ?? 0) / 100 // cost_report の amount はセント建て
      const key = `${date}|${c.model}|${c.token_type}`
      let share = 0
      if (total.has(key)) {
        share = (cbi.get(key) ?? 0) / (total.get(key) || 1)
      } else {
        // 種別が一致しないときは、そのモデルのその日の全トークンに占める割合で代用する
        let t = 0
        let m = 0
        for (const [k, n] of total) if (k.startsWith(`${date}|${c.model}|`)) t += n
        for (const [k, n] of cbi) if (k.startsWith(`${date}|${c.model}|`)) m += n
        share = t > 0 ? m / t : 0
      }
      const est = usd * share
      // 残高は CiDAO のキー分だけを基準額から引く（2026-10-11 事業主決定。N's factory 分は含めない）
      if (hasBaseline && bucketMs >= Date.UTC(new Date(baselineMs).getUTCFullYear(), new Date(baselineMs).getUTCMonth(), new Date(baselineMs).getUTCDate())) {
        spentSinceBaseline += est
      }
      if (bucketMs < since30 || est <= 0) continue
      daily.set(date, (daily.get(date) ?? 0) + est)
      byModel.set(c.model ?? '不明', (byModel.get(c.model ?? '不明') ?? 0) + est)
    }
  }

  const days = [...daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const sum = (list: [string, number][]) => list.reduce((a, [, v]) => a + v, 0)
  const last7 = new Date(todayUtc - 7 * DAY_MS).toISOString().slice(0, 10)

  const expiry = cbiKeys
    .filter((k) => k.status === 'active' && k.expires_at)
    .map((k) => ({
      name: k.name ?? '',
      expiresAt: k.expires_at!,
      daysLeft: Math.ceil((new Date(k.expires_at!).getTime() - Date.now()) / DAY_MS),
    }))

  return {
    ok: true,
    checkedAt: now.toISOString(),
    credit: hasBaseline
      ? {
          remainingUsd: Number((baselineUsd - spentSinceBaseline).toFixed(2)),
          baselineAt,
          thresholdUsd: Number(process.env.CREDIT_ALERT_THRESHOLD_USD ?? '5'),
        }
      : null,
    cbi: {
      keys: cbiKeys.map((k) => ({
        name: k.name ?? '',
        status: k.status ?? '',
        tokens30d: cbiTokensByKey.get(k.id) ?? 0,
      })),
      cost30dEstUsd: Number(sum(days).toFixed(3)),
      cost7dEstUsd: Number(sum(days.filter(([d]) => d >= last7)).toFixed(3)),
      daily: days.map(([date, v]) => ({ date, estUsd: Number(v.toFixed(4)) })),
      byModel: [...byModel.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, v]) => ({ model, estUsd: Number(v.toFixed(3)) })),
    },
    keyExpiry: expiry,
  }
}

let cache: { at: number; body: Awaited<ReturnType<typeof build>> } | null = null

export async function POST(request: Request) {
  const headers = corsHeaders(request)
  const expected = process.env.CBI_ADMIN_PASSWORD ?? ''
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'サーバー側にパスワードが未設定です（Vercelの環境変数 CBI_ADMIN_PASSWORD）' },
      { status: 503, headers },
    )
  }

  let body: { password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'リクエストの形式が不正です' }, { status: 400, headers })
  }
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || !passwordMatches(password, expected)) {
    return NextResponse.json({ ok: false, error: '認証に失敗しました' }, { status: 401, headers })
  }

  const adminKey = process.env.ANTHROPIC_ADMIN_KEY ?? ''
  if (!adminKey) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_ADMIN_KEY が未設定です' }, { status: 503, headers })
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body, { headers })
  }
  try {
    const result = await build(adminKey)
    cache = { at: Date.now(), body: result }
    return NextResponse.json(result, { headers })
  } catch (e) {
    console.error('[anthropic-usage] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: '取得に失敗しました: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 502, headers },
    )
  }
}
