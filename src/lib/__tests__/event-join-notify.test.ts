import { beforeEach, describe, expect, it, vi } from 'vitest'

const { holder, insertNotification } = vi.hoisted(() => ({
  holder: { event: null as unknown, parts: [] as unknown[] },
  insertNotification: vi.fn(),
}))

vi.mock('@/lib/notify', () => ({ insertNotification }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      b.maybeSingle = () => Promise.resolve({ data: table === 'events' ? holder.event : null, error: null })
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: table === 'event_participants' ? holder.parts : [], error: null }).then(res, rej)
      return b
    },
  }),
}))

import { buildJoinNotice, notifyOrganizersOfJoin } from '@/lib/event-join-notify'

describe('buildJoinNotice', () => {
  it('定員なしなら人数だけ', () => {
    expect(buildJoinNotice({ title: 'マルシェ', participantCount: 3, capacity: null })).toEqual({
      title: '「マルシェ」に参加登録がありました',
      body: '現在 3名',
    })
  })

  it('定員ありなら「現在 N名 / 定員 M名」、満員になったらそう書く', () => {
    expect(buildJoinNotice({ title: 'x', participantCount: 4, capacity: 5 }).body).toBe('現在 4名 / 定員 5名')
    expect(buildJoinNotice({ title: 'x', participantCount: 5, capacity: 5 }).body).toBe('現在 5名 / 定員 5名（定員に達しました）')
  })
})

describe('notifyOrganizersOfJoin', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-example'
    insertNotification.mockReset()
    insertNotification.mockResolvedValue({ inserted: true, pushed: 0 })
    holder.event = { title: '武蔵屋マルシェ', capacity: 10 }
    holder.parts = [
      { member_id: 'org1', role: 'organizer' },
      { member_id: 'org2', role: 'organizer' },
      { member_id: 'staff1', role: 'staff' },
      { member_id: 'p1', role: 'participant' },
      { member_id: 'p2', role: 'participant' },
    ]
  })

  it('主催者だけに、人数を書いた通知を送る（スタッフ・参加者には送らない）', async () => {
    const sent = await notifyOrganizersOfJoin({ eventId: 'ev1', memberId: 'p2' })
    expect(sent).toBe(2)
    expect(insertNotification).toHaveBeenCalledTimes(2)
    expect(insertNotification.mock.calls.map((c) => c[0].recipientId)).toEqual(['org1', 'org2'])
    expect(insertNotification.mock.calls[0][0]).toMatchObject({
      actorId: 'p2',
      kind: 'event',
      title: '「武蔵屋マルシェ」に参加登録がありました',
      body: '現在 2名 / 定員 10名',
      linkUrl: '/events/ev1',
    })
  })

  it('通知に会員の名前を載せない（誰が登録したかは名簿で確かめる）', async () => {
    await notifyOrganizersOfJoin({ eventId: 'ev1', memberId: 'p2' })
    const text = JSON.stringify(insertNotification.mock.calls)
    expect(text).not.toContain('display_name')
  })

  it('主催者が居なければ何も送らない', async () => {
    holder.parts = [{ member_id: 'p1', role: 'participant' }]
    expect(await notifyOrganizersOfJoin({ eventId: 'ev1', memberId: 'p1' })).toBe(0)
    expect(insertNotification).not.toHaveBeenCalled()
  })

  it('イベントが見つからない・サーバー設定が無いときは 0（例外にしない）', async () => {
    holder.event = null
    expect(await notifyOrganizersOfJoin({ eventId: 'nope', memberId: 'p1' })).toBe(0)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await notifyOrganizersOfJoin({ eventId: 'ev1', memberId: 'p1' })).toBe(0)
  })
})
