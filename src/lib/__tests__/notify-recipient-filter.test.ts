import { beforeEach, describe, expect, it, vi } from 'vitest'

const { holder, sendWebPushToMany } = vi.hoisted(() => ({
  holder: { members: [] as unknown[], inserted: [] as { recipient_id: string }[] },
  sendWebPushToMany: vi.fn(),
}))

vi.mock('@/lib/push', () => ({ sendWebPush: vi.fn(), sendWebPushToMany }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      if (table === 'members') {
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.is = () => Promise.resolve({ data: holder.members, error: null })
        return b
      }
      return {
        insert: (rows: { recipient_id: string }[]) => {
          holder.inserted.push(...rows)
          return Promise.resolve({ error: null })
        },
      }
    },
  }),
}))

import { notifyAllMembers } from '@/lib/notify'
import { wantsInstantEvent } from '@/lib/event-notify-mode'

describe('notifyAllMembers の recipientFilter（新着イベントを『その都度』の人だけにすぐ送る）', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-example'
    holder.inserted = []
    sendWebPushToMany.mockReset()
    sendWebPushToMany.mockResolvedValue(0)
    holder.members = [
      { id: 'actor', contact_preferences: {} },
      { id: 'unset', contact_preferences: {} },
      { id: 'instant', contact_preferences: { notify_event: true, event_notify_mode: 'instant' } },
      { id: 'digest', contact_preferences: { notify_event: true, event_notify_mode: 'digest' } },
      { id: 'off', contact_preferences: { notify_event: false, event_notify_mode: 'off' } },
      { id: 'offOld', contact_preferences: { notify_event: false } },
      { id: 'nullPrefs', contact_preferences: null },
    ]
  })

  const base = { kind: 'event' as const, title: 't', actorId: 'actor', prefKey: 'notify_event' }

  it('『その都度』（未設定も含む）の人だけに届く。まとめの人・受け取らない人・登録した本人には届かない', async () => {
    const r = await notifyAllMembers({ ...base, recipientFilter: wantsInstantEvent })
    expect(holder.inserted.map((x) => x.recipient_id).sort()).toEqual(['instant', 'nullPrefs', 'unset'])
    expect(r.recipients).toBe(3)
    expect(sendWebPushToMany.mock.calls[0][0].recipientIds.sort()).toEqual(['instant', 'nullPrefs', 'unset'])
  })

  it('recipientFilter を付けない呼び出し（運営からのお知らせ等）は、これまでと同じ動き', async () => {
    await notifyAllMembers({ kind: 'system', title: 't' })
    expect(holder.inserted).toHaveLength(7)
  })

  it('prefKey だけの呼び出しも、これまでと同じ動き（notify_event=false の人だけ外れる）', async () => {
    await notifyAllMembers({ ...base })
    expect(holder.inserted.map((x) => x.recipient_id).sort()).toEqual(['digest', 'instant', 'nullPrefs', 'unset'])
  })
})
