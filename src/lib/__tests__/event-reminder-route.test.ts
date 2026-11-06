import { beforeEach, describe, expect, it, vi } from 'vitest'

const { holder, notifyMembers } = vi.hoisted(() => ({
  holder: { tables: {} as Record<string, unknown[]>, calls: [] as string[] },
  notifyMembers: vi.fn(),
}))

vi.mock('@/lib/notify', () => ({ notifyMembers }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      holder.calls.push(table)
      const result = { data: holder.tables[table] ?? [], error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt']) b[m] = () => b
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
      return b
    },
  }),
}))

import { GET } from '@/app/api/cron/event-reminder/route'

const SECRET = 'cron-secret-example'

function req(opts: { token?: string; query?: string } = {}) {
  return new Request(`https://example.test/api/cron/event-reminder${opts.query ?? ''}`, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
  })
}

describe('GET /api/cron/event-reminder', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-example'
    holder.tables = {}
    holder.calls = []
    notifyMembers.mockReset()
    notifyMembers.mockImplementation(async (i: { recipientIds: string[] }) => ({
      recipients: i.recipientIds.length,
      pushed: 1,
      broadcastId: 'b1',
    }))
  })

  it('合言葉が無い・違うと 401、CRON_SECRET 未設定は 503。DB には触らない', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req({ token: 'wrong' }))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(req({ token: SECRET }))).status).toBe(503)
    expect(holder.calls).toEqual([])
  })

  it('あしたのイベントが無ければ何も送らない', async () => {
    const res = await GET(req({ token: SECRET }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ events: 0, sent: 0 })
    expect(notifyMembers).not.toHaveBeenCalled()
  })

  it('参加者へ送る。OFFの人・退会した人・受信済みの人は除く', async () => {
    holder.tables = {
      events: [{ id: 'ev1', title: '武蔵屋マルシェ', start_at: '2026-11-08T05:00:00Z', location: '武蔵屋', online_flag: false }],
      event_participants: [
        { event_id: 'ev1', member_id: 'a' }, // 送る
        { event_id: 'ev1', member_id: 'b' }, // イベント通知OFF
        { event_id: 'ev1', member_id: 'c' }, // 受信済み
        { event_id: 'ev1', member_id: 'gone' }, // 退会（members に居ない）
        { event_id: 'ev1', member_id: 'org' }, // 主催者にも送る
      ],
      members: [
        { id: 'a', contact_preferences: {} },
        { id: 'b', contact_preferences: { notify_event: false } },
        { id: 'c', contact_preferences: {} },
        { id: 'org', contact_preferences: null },
      ],
      notifications: [{ recipient_id: 'c', link_url: '/events/ev1#remind-1d' }],
    }
    const res = await GET(req({ token: SECRET }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(notifyMembers).toHaveBeenCalledTimes(1)
    expect(notifyMembers).toHaveBeenCalledWith({
      recipientIds: ['a', 'org'],
      kind: 'event',
      title: '明日のイベント「武蔵屋マルシェ」',
      body: '11月8日 14:00〜 / 武蔵屋',
      linkUrl: '/events/ev1#remind-1d',
    })
    expect(json).toMatchObject({ events: 1, sent: 2, pushed: 1 })
  })

  it('応答に会員のIDや名前を載せない（イベントごとの人数だけ）', async () => {
    holder.tables = {
      events: [{ id: 'ev1', title: 'x', start_at: '2026-11-08T05:00:00Z', location: null, online_flag: true }],
      event_participants: [{ event_id: 'ev1', member_id: 'secret-member-id' }],
      members: [{ id: 'secret-member-id', contact_preferences: {} }],
    }
    const text = await (await GET(req({ token: SECRET }))).text()
    expect(text).not.toContain('secret-member-id')
  })

  it('dryRun=1 は通知を作らず、人数だけ返す', async () => {
    holder.tables = {
      events: [{ id: 'ev1', title: 'x', start_at: '2026-11-08T05:00:00Z', location: null, online_flag: true }],
      event_participants: [
        { event_id: 'ev1', member_id: 'a' },
        { event_id: 'ev1', member_id: 'b' },
      ],
      members: [
        { id: 'a', contact_preferences: {} },
        { id: 'b', contact_preferences: {} },
      ],
    }
    const json = await (await GET(req({ token: SECRET, query: '?dryRun=1' }))).json()
    expect(notifyMembers).not.toHaveBeenCalled()
    expect(json).toMatchObject({ dryRun: true, events: 1, sent: 2 })
  })
})
