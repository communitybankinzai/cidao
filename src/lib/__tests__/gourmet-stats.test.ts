import { describe, expect, it } from 'vitest'
import { dailyRegistrations, totals } from '../gourmet-stats'

describe('dailyRegistrations', () => {
  const now = new Date('2026-11-14T03:00:00Z') // 日本時間 11/14 12:00
  it('直近の日数ぶんを古い順に並べ、登録の無い日は 0', () => {
    const s = dailyRegistrations([], 3, now)
    expect(s.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14'])
    expect(totals(s).all).toBe(0)
  })
  it('日本時間で日を分け、自動と手動を別に数える', () => {
    const s = dailyRegistrations([
      { created_at: '2026-11-13T15:30:00Z', auto: true },  // 日本時間 11/14 00:30
      { created_at: '2026-11-13T14:59:00Z', auto: false }, // 日本時間 11/13 23:59
      { created_at: '2026-11-14T01:00:00Z', auto: true },
      { created_at: '2026-10-01T00:00:00Z', auto: true },  // 期間外
    ], 3, now)
    expect(s[1]).toEqual({ day: '2026-11-13', auto: 0, manual: 1 })
    expect(s[2]).toEqual({ day: '2026-11-14', auto: 2, manual: 0 })
    expect(totals(s)).toEqual({ auto: 2, manual: 1, all: 3 })
  })
})
