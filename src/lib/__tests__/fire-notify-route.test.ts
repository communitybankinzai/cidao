import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyFireIncident } = vi.hoisted(() => ({ notifyFireIncident: vi.fn() }))
vi.mock('@/lib/disaster-notify', async () => {
  const actual = await vi.importActual<typeof import('@/lib/disaster-notify')>('@/lib/disaster-notify')
  return { ...actual, notifyFireIncident }
})

import { fireNotifyToken } from '@/lib/disaster-notify'
import { POST } from '@/app/api/disaster/fire-notify/route'

const KEY = 'service-role-key-example'
const incident = { id: 'thread-1', kind: 'fire', status: 'active', addressText: '浦部2213番氏神', receivedAtIso: '2026-10-16T11:00:00Z' }

function req(body: unknown, token?: string) {
  return new Request('https://example.test/api/disaster/fire-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/disaster/fire-notify', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY
    notifyFireIncident.mockReset()
    notifyFireIncident.mockResolvedValue({ sent: true, recipients: 3 })
  })

  it('合言葉が無い・違うと 401 で、通知は動かない', async () => {
    expect((await POST(req({ incident }))).status).toBe(401)
    expect((await POST(req({ incident }, 'wrong'))).status).toBe(401)
    expect(notifyFireIncident).not.toHaveBeenCalled()
  })

  it('キー未設定は 503', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect((await POST(req({ incident }, fireNotifyToken(KEY)))).status).toBe(503)
  })

  it('正しい合言葉なら 1 件を通知に渡す（必要な項目だけ）', async () => {
    const res = await POST(req({ incident: { ...incident, rawExcerpt: '渡さない本文' } }, fireNotifyToken(KEY)))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: true, recipients: 3 })
    expect(notifyFireIncident).toHaveBeenCalledWith({
      id: 'thread-1', kind: 'fire', status: 'active', addressText: '浦部2213番氏神', receivedAtIso: '2026-10-16T11:00:00Z',
    })
  })

  it('壊れた本文・id なしは 400', async () => {
    const token = fireNotifyToken(KEY)
    expect((await POST(req('{bad', token))).status).toBe(400)
    expect((await POST(req({}, token))).status).toBe(400)
    expect((await POST(req({ incident: { kind: 'fire' } }, token))).status).toBe(400)
    expect(notifyFireIncident).not.toHaveBeenCalled()
  })

  it('通知の中で失敗したら 500（見張りは止めずログに残す）', async () => {
    notifyFireIncident.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(req({ incident }, fireNotifyToken(KEY)))
    expect(res.status).toBe(500)
  })
})
