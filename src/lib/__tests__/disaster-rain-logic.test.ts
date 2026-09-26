// 雨の判定（2026-09-26 作り直し）：排水が追いつかない雨（バケツ）と、水が引くまでの時間（先行降雨）。

import { describe, expect, it } from 'vitest'
import { DEFAULT_RAIN_PARAMS, rainContext, stationWeights } from '@/lib/disaster-rain-logic'

const DAY = 144 // 10分×144＝24時間
const dry = (n: number) => Array<number | null>(n).fill(0)
const rain = (n: number, mmPerHour: number) => Array<number | null>(n).fill(mmPerHour / 6)

describe('rainContext', () => {
  it('7日間まったく降らなければ no_rain', () => {
    expect(rainContext(dry(7 * DAY))).toMatchObject({ verdict: 'no_rain', basis: null, r72h: 0 })
  })

  it('1時間60mm（排水50mm/hを超える）が30分続けば、雨の強さで flood_likely', () => {
    const c = rainContext([...dry(7 * DAY - 3), ...rain(3, 60)])
    // 10分ごとに 10mm 降り 8.33mm 抜ける → 3コマで約5mm あふれる
    expect(c).toMatchObject({ verdict: 'flood_likely', basis: 'intensity' })
    expect(c.bucketMax3h).toBeGreaterThanOrEqual(DEFAULT_RAIN_PARAMS.bucketMm)
  })

  it('降り始め：1時間20mmが1時間だけなら排水が追いつき、冠水のおそれにしない', () => {
    expect(rainContext([...dry(7 * DAY - 6), ...rain(6, 20)])).toMatchObject({ verdict: 'light_rain', bucketMax3h: 0 })
  })

  it('大雨の後：24時間で約300mm降り、止んでから1日たっても aftermath で flood_likely', () => {
    const c = rainContext([...dry(5 * DAY), ...rain(DAY, 12.5), ...dry(DAY)])
    expect(c).toMatchObject({ verdict: 'flood_likely', basis: 'aftermath' })
    expect(c.api).toBeGreaterThanOrEqual(DEFAULT_RAIN_PARAMS.apiMm)
  })

  it('大雨の後でも、日がたてば冠水のおそれから外れる（半減期48時間）', () => {
    const c = rainContext([...rain(DAY, 12.5), ...dry(6 * DAY)])
    expect(c.verdict).not.toBe('flood_likely')
  })

  it('直近24時間の3割以上が欠測なら unknown', () => {
    const values = [...dry(6 * DAY), ...Array<number | null>(DAY).fill(null)]
    expect(rainContext(values).verdict).toBe('unknown')
  })

  it('数値を変えると判定が変わる（排水を10mm/hにすると1時間20mmでもあふれる）', () => {
    const values = [...dry(7 * DAY - 6), ...rain(6, 20)]
    expect(rainContext(values, { ...DEFAULT_RAIN_PARAMS, drainMmPerHour: 10 })).toMatchObject({ verdict: 'flood_likely', basis: 'intensity' })
  })
})

describe('stationWeights', () => {
  const dist = ([a, b]: [number, number], [c, d]: [number, number]) => Math.hypot(a - c, b - d) * 100000
  it('近い4か所を距離の2乗の逆数で重み付けし、合計1にする', () => {
    const st = [{ lat: 0, lon: 0.01 }, { lat: 0, lon: 0.02 }, { lat: 0, lon: 0.1 }, { lat: 0, lon: 0.2 }, { lat: 0, lon: 0.25 }]
    const w = stationWeights([0, 0], st, dist)
    expect(w).toHaveLength(4)
    expect(w.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(1)
    expect(w[0].weight).toBeGreaterThan(w[1].weight)
  })
})
