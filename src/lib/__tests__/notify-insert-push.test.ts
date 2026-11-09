import { beforeEach, describe, expect, it, vi } from 'vitest'

const { holder, sendWebPush } = vi.hoisted(() => ({
  holder: { inserted: [] as unknown[] },
  sendWebPush: vi.fn(),
}))

vi.mock('@/lib/push', () => ({ sendWebPush, sendWebPushToMany: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      return {
        insert: (row: unknown) => {
          holder.inserted.push(row)
          const b: Record<string, unknown> = {}
          b.select = () => b
          b.single = () => Promise.resolve({ data: { id: 'n1' }, error: null })
          return b
        },
      }
    },
  }),
}))

import { insertNotification } from '@/lib/notify'

describe('insertNotification の push 指定（ベルだけにできる）', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-example'
    holder.inserted = []
    sendWebPush.mockReset()
    sendWebPush.mockResolvedValue(2)
  })

  const base = { recipientId: 'me', kind: 'event' as const, title: 't', body: 'b', linkUrl: '/events/e1' }

  it('指定なしは従来どおり、ベルを作ってスマホにも送る', async () => {
    const r = await insertNotification(base)
    expect(r).toMatchObject({ inserted: true, pushed: 2, notificationId: 'n1' })
    expect(holder.inserted).toHaveLength(1)
    expect(sendWebPush).toHaveBeenCalledTimes(1)
  })

  it('push: true も従来どおり送る', async () => {
    await insertNotification({ ...base, push: true })
    expect(sendWebPush).toHaveBeenCalledTimes(1)
  })

  it('push: false ならベルだけ作り、スマホには送らない（pushed は 0）', async () => {
    const r = await insertNotification({ ...base, push: false })
    expect(r).toMatchObject({ inserted: true, pushed: 0, notificationId: 'n1' })
    expect(holder.inserted).toHaveLength(1)
    expect(sendWebPush).not.toHaveBeenCalled()
  })

  it('宛先と actorId が同じなら、push の指定に関係なく何も作らない（従来の決まり）', async () => {
    const r = await insertNotification({ ...base, actorId: 'me', push: false })
    expect(r).toEqual({ inserted: false, pushed: 0 })
    expect(holder.inserted).toHaveLength(0)
  })
})
