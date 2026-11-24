import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALL_TRACK_NAMES,
  INSTALL_TRACK_ONCE_PREFIX,
  installTrackPath,
  trackInstall,
  trackInstallOnce,
} from '../install-track'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body))
}

describe('install-track', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('仮のパスは /go/<名前>。閲覧数の記録が受け付ける形（除外の接頭辞で始まらない）', () => {
    for (const name of INSTALL_TRACK_NAMES) {
      const path = installTrackPath(name)
      expect(path).toBe(`/go/${name}`)
      expect(path).toMatch(/^\/go\/[a-z-]+$/)
    }
  })

  it('匿名IDがあれば、そのIDで /api/track/view へ1件送る', () => {
    vi.stubGlobal('localStorage', fakeStorage({ cidao_visitor_id: 'v-1' }))
    trackInstall('install-tap')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/track/view')
    expect(sentBodies(fetchMock)[0]).toEqual({ path: '/go/install-tap', visitorId: 'v-1' })
  })

  it('匿名IDが無ければ作って覚え、そのIDで送る', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    trackInstall('install-shown')
    const id = storage.map.get('cidao_visitor_id')
    expect(id).toBeTruthy()
    expect(sentBodies(fetchMock)[0]).toEqual({ path: '/go/install-shown', visitorId: id })
  })

  it('保存領域が使えない端末では、送らず、落ちもしない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => trackInstall('install-tap')).not.toThrow()
    expect(trackInstallOnce('install-shown')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('端末ごとに1回：2回目は送らない。名前が違えば別に数える', () => {
    const storage = fakeStorage({ cidao_visitor_id: 'v-1' })
    vi.stubGlobal('localStorage', storage)
    expect(trackInstallOnce('install-standalone')).toBe(true)
    expect(trackInstallOnce('install-standalone')).toBe(false)
    expect(trackInstallOnce('install-added')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storage.map.has(INSTALL_TRACK_ONCE_PREFIX + 'install-standalone')).toBe(true)
    expect(sentBodies(fetchMock).map((b) => b.path)).toEqual(['/go/install-standalone', '/go/install-added'])
  })

  it('送信に失敗しても、落ちない', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ cidao_visitor_id: 'v-1' }))
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    expect(() => trackInstall('install-tap')).not.toThrow()
    await Promise.resolve()
  })
})
