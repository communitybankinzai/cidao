import { describe, expect, it } from 'vitest'
import { endAtForSave, formatEventRangeJst, plusOneHourLocal } from '../datetime'

const NOW = new Date('2026-11-27T00:00:00Z')

describe('終了時刻は未定', () => {
  it('表示：終了時刻を出さず「終了時刻は未定」と出す', () => {
    expect(formatEventRangeJst('2026-12-06T01:30:00Z', '2026-12-06T02:30:00Z', NOW, true)).toBe('12/6（日）10:30〜（終了時刻は未定）')
  })
  it('表示：印が無ければ、今までどおり終了時刻を出す', () => {
    expect(formatEventRangeJst('2026-12-06T01:30:00Z', '2026-12-06T02:30:00Z', NOW, false)).toBe('12/6（日）10:30〜11:30')
    expect(formatEventRangeJst('2026-12-06T01:30:00Z', '2026-12-06T02:30:00Z', NOW)).toBe('12/6（日）10:30〜11:30')
  })
  it('表示：来年の催しは年も付く', () => {
    expect(formatEventRangeJst('2027-01-23T01:30:00Z', '2027-01-23T02:30:00Z', NOW, true)).toBe('2027/1/23（土）10:30〜（終了時刻は未定）')
  })

  it('開始の1時間後を作る（日・月・年をまたいでも正しい）', () => {
    expect(plusOneHourLocal('2026-12-06T10:30')).toBe('2026-12-06T11:30')
    expect(plusOneHourLocal('2026-12-06T23:30')).toBe('2026-12-07T00:30')
    expect(plusOneHourLocal('2026-12-31T23:10')).toBe('2027-01-01T00:10')
    expect(plusOneHourLocal('x')).toBe('x')
  })

  it('保存する終了日時：未定なら開始の1時間後、決まっていれば入力のまま', () => {
    expect(endAtForSave('2026-12-06T10:30', '', true)).toBe('2026-12-06T11:30')
    expect(endAtForSave('2026-12-06T10:30', '2026-12-06T15:00', true)).toBe('2026-12-06T11:30')
    expect(endAtForSave('2026-12-06T10:30', '2026-12-06T15:00', false)).toBe('2026-12-06T15:00')
    expect(endAtForSave('2026-12-06T10:30', '2026-12-06T15:00', undefined)).toBe('2026-12-06T15:00')
  })
})
