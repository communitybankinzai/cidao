import { describe, expect, it } from 'vitest'
import { buildCells, fetchWindow, monthRangeUtc, parseYm, ymdInJst } from '../events-calendar'

describe('monthRangeUtc（日本時間の月の境目）', () => {
  it('2026年11月は 10/31 15:00 UTC 〜 11/30 15:00 UTC', () => {
    const { startUtc, endUtc } = monthRangeUtc(2026, 11)
    expect(startUtc.toISOString()).toBe('2026-10-31T15:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-11-30T15:00:00.000Z')
  })

  it('12月は翌年1月の境目まで', () => {
    expect(monthRangeUtc(2026, 12).endUtc.toISOString()).toBe('2026-12-31T15:00:00.000Z')
  })
})

describe('parseYm', () => {
  it('正しい YYYY-MM はそのまま', () => {
    expect(parseYm('2026-11')).toEqual({ y: 2026, m: 11 })
  })

  it('壊れた値・13月は今月にもどる（数値が返る）', () => {
    for (const raw of [undefined, '', '2026-13', 'abc', '2026-1']) {
      const r = parseYm(raw)
      expect(Number.isInteger(r.y)).toBe(true)
      expect(r.m).toBeGreaterThanOrEqual(1)
      expect(r.m).toBeLessThanOrEqual(12)
    }
  })
})

describe('buildCells', () => {
  it('42日ぶん・日曜はじまり。2026年11月1日は日曜なので最初のマス', () => {
    const cells = buildCells(2026, 11)
    expect(cells).toHaveLength(42)
    expect(cells[0]).toBe('2026-11-01')
    expect(cells[41]).toBe('2026-12-12')
  })

  it('月初が水曜なら、その週の日曜（前月）から始まる', () => {
    // 2026-04-01 は水曜
    const cells = buildCells(2026, 4)
    expect(cells[0]).toBe('2026-03-29')
    expect(cells[3]).toBe('2026-04-01')
  })
})

describe('fetchWindow', () => {
  it('カレンダー表示：月初の7日前〜月末の7日後', () => {
    const { fetchStart, fetchEnd } = fetchWindow(2026, 11, 'calendar')
    expect(fetchStart.toISOString()).toBe('2026-10-24T15:00:00.000Z')
    expect(fetchEnd.toISOString()).toBe('2026-12-07T15:00:00.000Z')
  })

  it('リスト表示：選んだ月から6か月先まで広がる', () => {
    const { fetchEnd } = fetchWindow(2026, 11, 'list')
    // 2027-05-01 00:00 JST の7日後
    expect(fetchEnd.toISOString()).toBe('2027-05-07T15:00:00.000Z')
  })

  it('年をまたぐ6か月先', () => {
    const { fetchEnd } = fetchWindow(2026, 8, 'list')
    // 2027-02-01 00:00 JST の7日後
    expect(fetchEnd.toISOString()).toBe('2027-02-07T15:00:00.000Z')
  })
})

describe('ymdInJst', () => {
  it('UTC の夕方は日本時間では翌日', () => {
    expect(ymdInJst(new Date('2026-11-07T16:00:00Z'))).toBe('2026-11-08')
  })
})
