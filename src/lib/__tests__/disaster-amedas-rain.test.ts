// 通れた道・通れない地点に付ける雨の判定（最寄りアメダスの雨量から flood_likely / light_rain / no_rain / unknown）。

import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('rainAt：気象庁からの取得', () => {
  const INZAI: [number, number] = [35.8325, 140.1454]   // 最寄りは我孫子
  const AT = new Date('2026-09-22T10:05:00+09:00')

  it('取得した10分値から判定する（記録時刻以前で最新の行を使う）', async () => {
    // 10:00 の行（1時間6mm）を使い、記録時刻より後の 10:10 の行は使わない
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      '20260922095000': { precipitation1h: [0, 0], precipitation3h: [0, 0], precipitation24h: [0, 0] },
      '20260922100000': { precipitation1h: [6, 0], precipitation3h: [7, 0], precipitation24h: [8, 0] },
      '20260922101000': { precipitation1h: [0, 0], precipitation3h: [0, 0], precipitation24h: [0, 0] },
    })))
    const rain = await rainAt(INZAI, AT)
    expect(rain).toMatchObject({ station: '我孫子', r1h: 6, r3h: 7, r24h: 8, verdict: 'flood_likely' })
  })

  it('通信に失敗したら unknown', async () => {
    // fetch 自体が例外（タイムアウト・DNS など）
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await rainAt(INZAI, AT)).toMatchObject({ station: '我孫子', verdict: 'unknown', r1h: null, r3h: null, r24h: null })
  })

  it('HTTP エラーなら unknown', async () => {
    // 気象庁が 503 を返した
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    expect((await rainAt(INZAI, AT)).verdict).toBe('unknown')
  })

  it('値がすべて品質フラグ付き（正常値でない）なら unknown', async () => {
    // [数値, フラグ] のフラグが 0 以外の値は使わない → 使える値が無い
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      '20260922100000': { precipitation1h: [0, 5], precipitation3h: [0, 5], precipitation24h: [0, 5] },
    })))
    expect((await rainAt(INZAI, AT)).verdict).toBe('unknown')
  })
})
