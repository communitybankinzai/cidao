import { describe, expect, it, vi } from 'vitest'
import type { MonitorAccount } from '../accounts'
import { checkInstagramHealth, checkRecentRuns, checkToken, REQUIRED_SCOPES, type RecentRun } from '../health'

const NOW = new Date('2026-10-16T09:00:00Z')
const TOKEN = 'EAAB' + 'x'.repeat(40) + 'BcnU'
const AUTH = { user_id: '17841443825933291', access_token: TOKEN }
const acc: MonitorAccount = { id: 'a1', username: 'communitybankinzai', label: 'CBI', kind: '団体', orgId: null }
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function debugBody(over: Record<string, unknown> = {}) {
  return { data: { is_valid: true, scopes: [...REQUIRED_SCOPES, 'public_profile'], expires_at: 0, data_access_expires_at: unix('2026-12-30T00:00:00Z'), ...over } }
}
const okRun = (source: string, startedAt: string): RecentRun => ({ source, started_at: startedAt, ok: true, errors: [] })
const freshRuns = [okRun('instagram-account', '2026-10-15T22:23:00Z'), okRun('instagram-hashtag', '2026-10-15T22:34:00Z')]

describe('checkToken', () => {
  it('有効・権限そろい・期限なしは ok。トークンは末尾4桁しか出さない', async () => {
    const fetchFn = vi.fn(async () => json(debugBody())) as unknown as typeof fetch
    const r = await checkToken(fetchFn, TOKEN, NOW)
    expect(r.status).toBe('ok')
    expect(r.detail).toContain('BcnU')
    expect(r.detail).not.toContain(TOKEN)
  })
  it('is_valid=false は fail', async () => {
    const fetchFn = (async () => json({ data: { is_valid: false, error: { message: 'Session has expired' } } })) as unknown as typeof fetch
    const r = await checkToken(fetchFn, TOKEN, NOW)
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('Session has expired')
  })
  it('権限が欠けると fail（欠けた名前を出す）', async () => {
    const fetchFn = (async () => json(debugBody({ scopes: ['instagram_basic'] }))) as unknown as typeof fetch
    const r = await checkToken(fetchFn, TOKEN, NOW)
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('instagram_manage_insights')
  })
  it('データアクセス期限が14日未満は warn・過ぎたら fail', async () => {
    const soon = (async () => json(debugBody({ data_access_expires_at: unix('2026-10-25T00:00:00Z') }))) as unknown as typeof fetch
    expect((await checkToken(soon, TOKEN, NOW)).status).toBe('warn')
    const past = (async () => json(debugBody({ data_access_expires_at: unix('2026-10-01T00:00:00Z') }))) as unknown as typeof fetch
    expect((await checkToken(past, TOKEN, NOW)).status).toBe('fail')
  })
  it('API が error を返したら fail', async () => {
    const fetchFn = (async () => json({ error: { code: 190, message: 'Invalid OAuth access token' } }, 400)) as unknown as typeof fetch
    const r = await checkToken(fetchFn, TOKEN, NOW)
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('190')
  })
  it('接続できないときも落ちずに fail', async () => {
    const fetchFn = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    expect((await checkToken(fetchFn, TOKEN, NOW)).status).toBe('fail')
  })
})

describe('checkRecentRuns', () => {
  it('新しい成功なら ok', () => {
    expect(checkRecentRuns(freshRuns, NOW).map((c) => c.status)).toEqual(['ok', 'ok'])
  })
  it('36時間より古いと fail、記録なしは warn', () => {
    const stale = [okRun('instagram-account', '2026-10-14T00:00:00Z')]
    const r = checkRecentRuns(stale, NOW)
    expect(r[0].status).toBe('fail')
    expect(r[1].status).toBe('warn')
  })
  it('直近が失敗なら理由つきで fail', () => {
    const r = checkRecentRuns([{ source: 'instagram-account', started_at: '2026-10-16T00:00:00Z', ok: false, errors: ['(#10) 権限なし'] }], NOW)
    expect(r[0].status).toBe('fail')
    expect(r[0].detail).toContain('(#10)')
  })
})

describe('checkInstagramHealth', () => {
  function routedFetch(opts: { discovery?: () => Response } = {}) {
    return (async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input))
      if (url.includes('/debug_token')) return json(debugBody())
      if (url.includes('business_discovery')) return opts.discovery ? opts.discovery() : json({ business_discovery: { id: '1', username: 'communitybankinzai', media_count: 12, media: { data: [] } } })
      if (url.includes('ig_hashtag_search')) return json({ data: [{ id: '17841520549080877' }] })
      return json({}, 404)
    }) as unknown as typeof fetch
  }

  it('すべて正常なら ok', async () => {
    const r = await checkInstagramHealth({ fetchFn: routedFetch(), now: NOW, auth: AUTH, accounts: [acc], recentRuns: freshRuns, paused: false })
    expect(r.status).toBe('ok')
    expect(r.checks.map((c) => c.name)).toEqual(['token', 'account:communitybankinzai', 'hashtag', 'last-run:instagram-account', 'last-run:instagram-hashtag'])
  })
  it('認証エラー(#10)は fail にする', async () => {
    const discovery = () => json({ error: { code: 10, message: 'Application does not have permission' } }, 400)
    const r = await checkInstagramHealth({ fetchFn: routedFetch({ discovery }), now: NOW, auth: AUTH, accounts: [acc], recentRuns: freshRuns, paused: false })
    expect(r.status).toBe('fail')
    expect(r.checks.find((c) => c.name === 'account:communitybankinzai')?.status).toBe('fail')
  })
  it('アカウント単体の「見つからない」は warn（鍵の問題ではない）', async () => {
    const discovery = () => json({ error: { code: 110, message: 'Invalid user id / cannot be found' } }, 400)
    const r = await checkInstagramHealth({ fetchFn: routedFetch({ discovery }), now: NOW, auth: AUTH, accounts: [acc], recentRuns: freshRuns, paused: false })
    expect(r.status).toBe('warn')
  })
  it('トークンが DB に無ければ fail・一時停止中は warn が付く', async () => {
    const r = await checkInstagramHealth({ fetchFn: routedFetch(), now: NOW, auth: null, accounts: [acc], recentRuns: freshRuns, paused: true })
    expect(r.status).toBe('fail')
    expect(r.checks.map((c) => c.name)).toContain('pause')
  })
})
