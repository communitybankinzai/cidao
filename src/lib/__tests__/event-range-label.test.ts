import { describe, expect, it } from 'vitest'
import { formatEventRangeJst } from '../datetime'

const NOW = new Date('2026-11-27T00:00:00Z')

describe('formatEventRangeJst', () => {
  it('同じ日は、終わりは時刻だけ（秒は出さない）', () => {
    expect(formatEventRangeJst('2026-11-28T04:00:00+00:00', '2026-11-28T07:00:00+00:00', NOW)).toBe('11/28（土）13:00〜16:00')
  })
  it('日をまたぐときは、終わりにも日付を付ける', () => {
    expect(formatEventRangeJst('2026-11-28T04:00:00Z', '2026-11-29T07:00:00Z', NOW)).toBe('11/28（土）13:00〜11/29（日）16:00')
  })
  it('今年でないときは、年を付ける', () => {
    expect(formatEventRangeJst('2027-01-23T01:30:00Z', '2027-01-23T03:00:00Z', NOW)).toBe('2027/1/23（土）10:30〜12:00')
  })
  it('年をまたぐときは、終わりにも年を付ける', () => {
    expect(formatEventRangeJst('2026-12-31T13:00:00Z', '2027-01-01T01:00:00Z', NOW)).toBe('12/31（木）22:00〜2027/1/1（金）10:00')
  })
  it('日本時間の0時は 00:00 と出す', () => {
    expect(formatEventRangeJst('2026-11-27T15:00:00Z', '2026-11-27T17:00:00Z', NOW)).toBe('11/28（土）00:00〜02:00')
  })
  it('読めない日時は空文字', () => {
    expect(formatEventRangeJst('x', 'y', NOW)).toBe('')
  })
})
