import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/cost-alert/route'

// cost-alert の GET を、Anthropic Admin API（fetch）を差し替えて呼ぶ。共用クレジットの実残高の警告まわりを確かめる。
// CREDIT_BASELINE_*（CiDAO 分の判定）は未設定にして、既存の判定と切り離す。

const NOW = new Date('2026-10-20T06:00:00Z')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function costBuckets(...cents: number[]) {
  return {
    data: cents.map((c, i) => ({
      starting_at: `2026-10-${String(19 + i).padStart(2, '0')}T00:00:00Z`,
      results: [{ amount: String(c), model: 'claude-opus-5-5', token_type: 'output_tokens' }],
    })),
  }
}

let calls: string[]

function stubFetch(handler: (path: string) => Response) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const u = new URL(String(input))
      calls.push(u.pathname)
      return handler(u.pathname)
    }),
  )
}

async function callCron() {
  const res = await GET(new Request('http://localhost/api/cron/cost-alert', { headers: { authorization: 'Bearer s3cret' } }))
  return {
    status: res.status,
    body: (await res.json()) as { shared_credit: Record<string, unknown>; alerted: boolean; mail: unknown },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.stubEnv('ANTHROPIC_ADMIN_KEY', 'sk-ant-admin01-test')
  for (const k of [
    'CREDIT_BASELINE_USD',
    'CREDIT_BASELINE_AT',
    'SHARED_CREDIT_BASELINE_USD',
    'SHARED_CREDIT_BASELINE_AT',
    'SHARED_CREDIT_ALERT_THRESHOLD_USD',
    'RESEND_API_KEY',
    'MAIL_FROM',
    'COST_ALERT_TO',
  ]) {
    vi.stubEnv(k, '')
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('cost-alert: 共用クレジットの実残高', () => {
  it('SHARED_CREDIT_BASELINE_* が未設定なら何もしない（既存の動きを変えない・組織全体の費用は取りに行かない）', async () => {
    stubFetch((p) => (p.endsWith('/api_keys') ? json({ data: [] }) : json({}, 500)))
    const { status, body } = await callCron()
    expect(status).toBe(200)
    expect(body.shared_credit).toEqual({ status: 'not_configured' })
    expect(body.alerted).toBe(false)
    expect(calls.some((p) => p.endsWith('/cost_report'))).toBe(false)
  })

  it('実残高が警告ラインより上なら、警告しない（残高 $25）', async () => {
    vi.stubEnv('SHARED_CREDIT_BASELINE_USD', '30')
    vi.stubEnv('SHARED_CREDIT_BASELINE_AT', '2026-10-19T00:00:00Z')
    stubFetch((p) => (p.endsWith('/cost_report') ? json(costBuckets(300, 200)) : json({ data: [] })))
    const { body } = await callCron()
    expect(body.shared_credit).toMatchObject({
      status: 'ok',
      baseline_usd: 30,
      org_spent_usd: 5,
      remaining_usd: 25,
      threshold_usd: 15,
      below_threshold: false,
    })
    expect(body.alerted).toBe(false)
  })

  it('実残高が警告ライン未満なら警告する（消費 $18・残高 $12）', async () => {
    vi.stubEnv('SHARED_CREDIT_BASELINE_USD', '30')
    vi.stubEnv('SHARED_CREDIT_BASELINE_AT', '2026-10-19T00:00:00Z')
    stubFetch((p) => (p.endsWith('/cost_report') ? json(costBuckets(1000, 800)) : json({ data: [] })))
    const { body } = await callCron()
    expect(body.shared_credit).toMatchObject({ status: 'ok', org_spent_usd: 18, remaining_usd: 12, below_threshold: true })
    expect(body.alerted).toBe(true)
    expect(String(body.mail)).toMatch(/^skipped/) // 送信設定が無いのでメールは送らない（警告が出たことはここで分かる）
  })

  it('警告ラインを環境変数で変えられる', async () => {
    vi.stubEnv('SHARED_CREDIT_BASELINE_USD', '30')
    vi.stubEnv('SHARED_CREDIT_BASELINE_AT', '2026-10-19T00:00:00Z')
    vi.stubEnv('SHARED_CREDIT_ALERT_THRESHOLD_USD', '26')
    stubFetch((p) => (p.endsWith('/cost_report') ? json(costBuckets(300, 200)) : json({ data: [] })))
    const { body } = await callCron()
    expect(body.shared_credit).toMatchObject({ remaining_usd: 25, threshold_usd: 26, below_threshold: true })
    expect(body.alerted).toBe(true)
  })

  it('設定が壊れているときは、黙って無効にせず警告に出す', async () => {
    vi.stubEnv('SHARED_CREDIT_BASELINE_USD', '30') // 日時が無い
    stubFetch(() => json({ data: [] }))
    const { body } = await callCron()
    expect(body.shared_credit.status).toBe('invalid')
    expect(body.alerted).toBe(true)
  })

  it('費用の取得に失敗したときは、失敗を警告に出す（監視が止まっていることに気づける）', async () => {
    vi.stubEnv('SHARED_CREDIT_BASELINE_USD', '30')
    vi.stubEnv('SHARED_CREDIT_BASELINE_AT', '2026-10-19T00:00:00Z')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch((p) => (p.endsWith('/cost_report') ? json({ error: 'x' }, 500) : json({ data: [] })))
    const { status, body } = await callCron()
    expect(status).toBe(200)
    expect(body.shared_credit).toEqual({ status: 'error' })
    expect(body.alerted).toBe(true)
  })

  it('点検のたびに、判定結果を1行ログに残す（未設定でも出る＝監視が動いていることが Logs で分かる）', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    stubFetch((p) => (p.endsWith('/api_keys') ? json({ data: [] }) : json({}, 500)))
    await callCron()
    expect(log).toHaveBeenCalledWith('[cron/cost-alert] shared_credit', JSON.stringify({ status: 'not_configured' }))

    log.mockClear()
    vi.stubEnv('SHARED_CREDIT_BASELINE_USD', '30')
    vi.stubEnv('SHARED_CREDIT_BASELINE_AT', '2026-10-19T00:00:00Z')
    stubFetch((p) => (p.endsWith('/cost_report') ? json(costBuckets(300, 200)) : json({ data: [] })))
    await callCron()
    const line = String(log.mock.calls.find((c) => c[0] === '[cron/cost-alert] shared_credit')?.[1])
    expect(JSON.parse(line)).toMatchObject({ status: 'ok', remaining_usd: 25 })
    expect(line).not.toMatch(/sk-ant|secret/i) // 鍵や秘密は出さない
  })

  it('Authorization が違えば 401（既存の保護を壊していない）', async () => {
    stubFetch(() => json({ data: [] }))
    const res = await GET(new Request('http://localhost/api/cron/cost-alert', { headers: { authorization: 'Bearer wrong' } }))
    expect(res.status).toBe(401)
  })
})
