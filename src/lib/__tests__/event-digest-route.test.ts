import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { holder, notifyMembers } = vi.hoisted(() => ({
  holder: {
    tables: {} as Record<string, unknown[]>,
    calls: [] as string[],
    filters: [] as { table: string; method: string; args: unknown[] }[],
  },
  notifyMembers: vi.fn(),
}))

vi.mock('@/lib/notify', () => ({ notifyMembers }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      holder.calls.push(table)
      const result = { data: holder.tables[table] ?? [], error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'like', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => {
          holder.filters.push({ table, method: m, args })
          return b
        }
      }
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
      return b
    },
  }),
}))

import { GET } from '@/app/api/cron/event-digest/route'

const SECRET = 'cron-secret-example'

function req(opts: { token?: string; query?: string } = {}) {
  return new Request(`https://example.test/api/cron/event-digest${opts.query ?? ''}`, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
  })
}

const DIGEST_MEMBERS = [
  { id: 'd1', contact_preferences: { notify_event: true, event_notify_mode: 'digest' } },
  { id: 'd2', contact_preferences: { event_notify_mode: 'digest' } },
  { id: 'i1', contact_preferences: { event_notify_mode: 'instant' } },
  { id: 'o1', contact_preferences: { notify_event: false, event_notify_mode: 'off' } },
]

describe('GET /api/cron/event-digest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-07T09:00:05Z')) // 日本時間 11/7 18:00 すぎ
    process.env.CRON_SECRET = SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-example'
    holder.tables = {}
    holder.calls = []
    holder.filters = []
    notifyMembers.mockReset()
    notifyMembers.mockImplementation(async (i: { recipientIds: string[] }) => ({
      recipients: i.recipientIds.length,
      pushed: 1,
      broadcastId: 'b1',
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('合言葉が無い・違うと 401、CRON_SECRET 未設定は 503。DB には触らない', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req({ token: 'wrong' }))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(req({ token: SECRET }))).status).toBe(503)
    expect(holder.calls).toEqual([])
  })

  it('新しく載ったイベントが無ければ何も送らない（会員の表も読まない）', async () => {
    const res = await GET(req({ token: SECRET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ events: 0, sent: 0 })
    expect(notifyMembers).not.toHaveBeenCalled()
    expect(holder.calls).toEqual(['events'])
  })

  it('前日18時〜当日18時に作られた公開中の、まだ始まっていないイベントだけを探す', async () => {
    await GET(req({ token: SECRET }))
    const f = holder.filters.filter((x) => x.table === 'events')
    const has = (method: string, ...args: unknown[]) =>
      f.some((x) => x.method === method && JSON.stringify(x.args) === JSON.stringify(args))
    expect(has('eq', 'status', 'open')).toBe(true)
    expect(has('gte', 'created_at', '2026-11-06T09:00:00.000Z')).toBe(true)
    expect(has('lt', 'created_at', '2026-11-07T09:00:00.000Z')).toBe(true)
    expect(has('gte', 'start_at', '2026-11-07T09:00:00.000Z')).toBe(true)
  })

  it('『毎日まとめて』の人だけに1通ずつ送る。その都度・受け取らない人には送らない', async () => {
    holder.tables.events = [
      { id: 'e1', title: '朝市', start_at: '2026-11-14T00:00:00Z', location: '駅前', online_flag: false },
    ]
    holder.tables.members = DIGEST_MEMBERS
    const res = await GET(req({ token: SECRET }))
    const json = await res.json()
    expect(json).toMatchObject({ events: 1, sent: 2, pushed: 1 })
    expect(notifyMembers).toHaveBeenCalledTimes(1)
    const arg = notifyMembers.mock.calls[0][0]
    expect(arg.recipientIds).toEqual(['d1', 'd2'])
    expect(arg.kind).toBe('event')
    expect(arg.title).toBe('新しいイベント「朝市」が登録されました')
    expect(arg.linkUrl).toBe('/events/e1#digest-20261107')
  })

  it('その日のまとめを受け取った人には送らない。応答に会員の名前や識別子を載せない', async () => {
    holder.tables.events = [
      { id: 'e1', title: '朝市', start_at: '2026-11-14T00:00:00Z', location: null, online_flag: false },
    ]
    holder.tables.members = DIGEST_MEMBERS
    holder.tables.notifications = [{ recipient_id: 'd1' }]
    const res = await GET(req({ token: SECRET }))
    const text = JSON.stringify(await res.json())
    expect(notifyMembers.mock.calls[0][0].recipientIds).toEqual(['d2'])
    expect(text).not.toContain('d1')
    expect(text).not.toContain('d2')
  })

  it('宛先が0人なら送らない', async () => {
    holder.tables.events = [
      { id: 'e1', title: '朝市', start_at: '2026-11-14T00:00:00Z', location: null, online_flag: false },
    ]
    holder.tables.members = [DIGEST_MEMBERS[2], DIGEST_MEMBERS[3]]
    const res = await GET(req({ token: SECRET }))
    expect(await res.json()).toMatchObject({ events: 1, sent: 0, note: 'no recipients' })
    expect(notifyMembers).not.toHaveBeenCalled()
  })

  it('?dryRun=1 は通知を作らず、人数だけ返す', async () => {
    holder.tables.events = [
      { id: 'e1', title: '朝市', start_at: '2026-11-14T00:00:00Z', location: null, online_flag: false },
      { id: 'e2', title: '映画会', start_at: '2026-11-15T00:00:00Z', location: null, online_flag: false },
    ]
    holder.tables.members = DIGEST_MEMBERS
    const res = await GET(req({ token: SECRET, query: '?dryRun=1' }))
    expect(await res.json()).toMatchObject({ dryRun: true, events: 2, sent: 2, title: '新しいイベントが2件 登録されました' })
    expect(notifyMembers).not.toHaveBeenCalled()
  })
})
