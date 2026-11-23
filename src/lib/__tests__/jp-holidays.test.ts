import { describe, expect, it } from 'vitest'
import { isJapaneseHoliday, jstParts } from '@/lib/jp-holidays'
import { autoHospitalDay } from '@/lib/hospitals'

// 内閣府「国民の祝日について」の 2026年・2027年の一覧と照らす
const HOLIDAYS_2026 = [
  [1, 1], [1, 12], [2, 11], [2, 23], [3, 20], [4, 29],
  [5, 3], [5, 4], [5, 5], [5, 6], // 5/3 が日曜 → 5/6 が振替休日
  [7, 20], [8, 11],
  [9, 21], [9, 22], [9, 23], // 9/22 は敬老の日と秋分の日にはさまれた国民の休日
  [10, 12], [11, 3], [11, 23],
]
const HOLIDAYS_2027 = [
  [1, 1], [1, 11], [2, 11], [2, 23],
  [3, 21], [3, 22], // 春分の日が日曜 → 3/22 が振替休日
  [4, 29], [5, 3], [5, 4], [5, 5],
  [7, 19], [8, 11], [9, 20], [9, 23], [10, 11], [11, 3], [11, 23],
]

function allHolidays(year: number): string[] {
  const out: string[] = []
  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate()
    for (let d = 1; d <= days; d++) if (isJapaneseHoliday(year, m, d)) out.push(`${m}/${d}`)
  }
  return out
}

describe('日本の祝日の計算', () => {
  it('2026年の祝日・休日が、内閣府の一覧と1日も違わない', () => {
    expect(allHolidays(2026)).toEqual(HOLIDAYS_2026.map(([m, d]) => `${m}/${d}`))
  })

  it('2027年の祝日・休日が、内閣府の一覧と1日も違わない', () => {
    expect(allHolidays(2027)).toEqual(HOLIDAYS_2027.map(([m, d]) => `${m}/${d}`))
  })

  it('年末年始は 1/1 だけが祝日', () => {
    expect(isJapaneseHoliday(2026, 12, 29)).toBe(false)
    expect(isJapaneseHoliday(2026, 12, 31)).toBe(false)
    expect(isJapaneseHoliday(2027, 1, 2)).toBe(false)
    expect(isJapaneseHoliday(2027, 1, 3)).toBe(false)
  })

  it('日本の日付と時刻に直せる（日付が変わる前後）', () => {
    // UTC 11/22 15:30 ＝ 日本 11/23 00:30（月）
    expect(jstParts(new Date('2026-11-22T15:30:00Z'))).toEqual({ y: 2026, m: 11, d: 23, dow: 1, hour: 0 })
    // UTC 11/22 14:59 ＝ 日本 11/22 23:59（日）
    expect(jstParts(new Date('2026-11-22T14:59:00Z'))).toMatchObject({ d: 22, dow: 0, hour: 23 })
  })
})

describe('病院マップ：開いたときに選んでおく曜日', () => {
  const at = (iso: string) => autoHospitalDay(new Date(iso))

  it('日曜は「日曜」', () => {
    expect(at('2026-11-22T03:00:00Z')).toBe('sun')
  })
  it('祝日（月）は「祝日」。日付が変わった直後も', () => {
    expect(at('2026-11-23T04:00:00Z')).toBe('hol')
    expect(at('2026-11-22T15:30:00Z')).toBe('hol')
  })
  it('振替休日・国民の休日も「祝日」', () => {
    expect(at('2026-05-06T01:00:00Z')).toBe('hol')
    expect(at('2026-09-22T01:00:00Z')).toBe('hol')
  })
  it('日曜と祝日が重なる日は「日曜」', () => {
    expect(at('2026-05-03T01:00:00Z')).toBe('sun')
  })
  it('土曜は正午から「土曜午後」、午前は「すべて」', () => {
    expect(at('2026-11-28T02:59:00Z')).toBe('all')
    expect(at('2026-11-28T03:00:00Z')).toBe('satPm')
  })
  it('平日は「すべて」', () => {
    expect(at('2026-11-24T03:00:00Z')).toBe('all')
    expect(at('2026-12-30T03:00:00Z')).toBe('all')
  })
})
