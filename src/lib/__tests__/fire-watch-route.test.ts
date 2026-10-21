import { beforeEach, describe, expect, it, vi } from 'vitest'

const { upsert, maybeSingle } = vi.hoisted(() => ({ upsert: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert,
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}))

import { fireNotifyToken } from '@/lib/disaster-notify'
import { GET, OPTIONS, POST } from '@/app/api/disaster/fire-watch/route'

const KEY = 'service-role-key-example'

function post(token?: string) {
  return new Request('https://example.test/api/disaster/fire-watch', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}
function get(origin = 'https://communitybankinzai.github.io') {
  return new Request('https://example.test/api/disaster/fire-watch', { headers: { Origin: origin } })
}

describe('/api/disaster/fire-watch', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    upsert.mockReset()
    upsert.mockResolvedValue({ error: null })
    maybeSingle.mockReset()
  })

  it('POST: 合言葉が無い・違うと 401 で、何も保存しない', async () => {
    expect((await POST(post())).status).toBe(401)
    expect((await POST(post('wrong'))).status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('POST: キー未設定は 503', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect((await POST(post(fireNotifyToken(KEY)))).status).toBe(503)
  })

  it('POST: 正しい合言葉ならサーバーの現在時刻を app_settings に1行だけ保存する', async () => {
    const before = Date.now()
    const res = await POST(post(fireNotifyToken(KEY)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Date.parse(body.checkedAt)).toBeGreaterThanOrEqual(before)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith({ key: 'fire_mail_watch_heartbeat', value: { checkedAt: body.checkedAt } })
  })

  it('POST: 保存に失敗したら 500（見張りは止めずログに残す）', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'boom' } })
    expect((await POST(post(fireNotifyToken(KEY)))).status).toBe(500)
  })

  it('GET: 公開で、確認した時刻と経過秒だけを返す（CORS・キャッシュなし）', async () => {
    const at = new Date(Date.now() - 180_000).toISOString()
    maybeSingle.mockResolvedValueOnce({ data: { value: { checkedAt: at } }, error: null })
    const res = await GET(get())
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://communitybankinzai.github.io')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.checkedAt).toBe(at)
    expect(body.ageSeconds).toBeGreaterThanOrEqual(180)
    expect(body.ageSeconds).toBeLessThan(190)
    expect(Object.keys(body).sort()).toEqual(['ageSeconds', 'checkedAt'])
  })

  it('GET: まだ1回も届いていない・壊れた値なら null を返す', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await (await GET(get())).json()).toEqual({ checkedAt: null, ageSeconds: null })
    maybeSingle.mockResolvedValueOnce({ data: { value: { checkedAt: 'not-a-date' } }, error: null })
    expect(await (await GET(get())).json()).toEqual({ checkedAt: null, ageSeconds: null })
  })

  it('GET: 読み取りに失敗したら 500・キー未設定は 503', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect((await GET(get())).status).toBe(500)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect((await GET(get())).status).toBe(503)
  })

  it('OPTIONS: 許可した画面からの事前確認に 204 を返す', async () => {
    const res = OPTIONS(get('http://localhost:8766'))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8766')
  })
})
