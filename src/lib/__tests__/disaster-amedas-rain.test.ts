// 通れた道・通れない地点に付ける雨の判定。rainVerdict は旧判定（2026-09-26 まで・今は使っていない）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rainAt, rainVerdict } from '@/lib/disaster-amedas-rain'

afterEach(() => { vi.unstubAllGlobals() })

describe('rainVerdict：しきい値', () => {
  it('1時間5mm以上で flood_likely（4.9mm までは light_rain）', () => {
    // 1時間雨量だけがしきい値ちょうど
    expect(rainVerdict(5, 0, 0)).toBe('flood_likely')
    expect(rainVerdict(4.9, 0, 0)).toBe('light_rain')
  })

  it('3時間10mm以上で flood_likely（9.9mm までは light_rain）', () => {
    // 3時間雨量だけがしきい値ちょうど
    expect(rainVerdict(0, 10, 0)).toBe('flood_likely')
    expect(rainVerdict(0, 9.9, 0)).toBe('light_rain')
  })

  it('24時間30mm以上で flood_likely（29.9mm までは light_rain）', () => {
    // 24時間雨量だけがしきい値ちょうど
    expect(rainVerdict(0, 0, 30)).toBe('flood_likely')
    expect(rainVerdict(0, 0, 29.9)).toBe('light_rain')
  })

  it('すべて0なら no_rain', () => {
    // 1時間・3時間・24時間の雨量がどれも0
    expect(rainVerdict(0, 0, 0)).toBe('no_rain')
  })

  it('0としきい値の間は light_rain（欠けた値は0として扱う）', () => {
    // 少しでも降っていてしきい値に届かない／一部の値が取れていない
    expect(rainVerdict(0.5, 2, 12)).toBe('light_rain')
    expect(rainVerdict(null, 0.5, null)).toBe('light_rain')
    expect(rainVerdict(0, null, 0)).toBe('no_rain')
  })
})

describe('rainAt：周辺の観測点の10分値から判定（控えが無いときは気象庁）', () => {
  const INZAI: [number, number] = [35.8325, 140.1454]
  const AT = new Date('2026-09-22T10:05:00+09:00')
  // 記録の前24時間ぶんの10分値（どのファイルを頼まれても同じ中身を返す。窓の外の時刻は使われない）
  const block = (mmPer10: number, flag = 0) => {
    const out: Record<string, Record<string, [number, number]>> = {}
    for (let i = 0; i < 150; i += 1) {
      // 気象庁の10分値は 00分・10分… にそろっている
      const t = new Date(Math.floor(AT.getTime() / 600000) * 600000 - i * 600000 + 9 * 3600000)
      const key = t.toISOString().replace(/[-:T]/g, '').slice(0, 12) + '00'
      out[key] = { precipitation10m: [mmPer10, flag] }
    }
    return out
  }
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AT.getTime() + 3600000)) })
  afterEach(() => { vi.useRealTimers() })

  it('周辺4か所の平均で判定し、使った観測点の名前を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(block(0))))
    const rain = await rainAt(INZAI, AT)
    expect(rain.station).toMatch(/我孫子/)
    expect(rain.station).toMatch(/の平均$/)
    // 24時間より前は取れない（控えが無い）ので72時間の合計も0、雨なし
    expect(rain).toMatchObject({ verdict: 'no_rain', r24h: 0 })
  })

  it('1時間60mmの雨が続いていれば、雨の強さで flood_likely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(block(10))))
    expect(await rainAt(INZAI, AT)).toMatchObject({ verdict: 'flood_likely', basis: 'intensity' })
  })

  it('通信に失敗したら unknown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect((await rainAt(INZAI, AT)).verdict).toBe('unknown')
  })

  it('値がすべて品質フラグ付き（正常値でない）なら unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(block(0, 5))))
    expect((await rainAt(INZAI, AT)).verdict).toBe('unknown')
  })
})
