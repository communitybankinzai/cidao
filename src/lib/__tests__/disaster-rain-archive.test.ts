import { describe, expect, it } from 'vitest'
import {
  amedasFileTimes,
  amedasValue,
  cellCenter,
  classOfPixel,
  jmaTimeToIso,
  RADAR_CLASSES,
  RADAR_COLS,
  RADAR_ROWS,
} from '../disaster-rain-archive'

describe('雨雲レーダーの色 → 区分', () => {
  it('凡例の8色はそれぞれの区分になる', () => {
    RADAR_CLASSES.forEach((c, i) => expect(classOfPixel(c.rgb[0], c.rgb[1], c.rgb[2], 255)).toBe(i + 1))
  })
  it('透明は0（降っていない）', () => {
    expect(classOfPixel(160, 210, 255, 0)).toBe(0)
  })
  it('凡例から遠い色は0（地図の線などを雨と数えない）', () => {
    expect(classOfPixel(0, 0, 0, 255)).toBe(0)
    expect(classOfPixel(100, 100, 100, 255)).toBe(0)
  })
  it('少しにじんだ色は近い区分になる', () => {
    expect(classOfPixel(250, 40, 5, 255)).toBe(7)
  })
})

describe('升目と時刻', () => {
  it('升目は22行×36列で、印西市役所（35.832,140.146）を含む', () => {
    expect(RADAR_ROWS).toBe(22)
    expect(RADAR_COLS).toBe(36)
    const row = Math.floor((35.92 - 35.832) / 0.01)
    const col = Math.floor((140.146 - 140.0) / 0.01)
    const c = cellCenter(row, col)
    expect(Math.abs(c.lat - 35.832)).toBeLessThan(0.005)
    expect(Math.abs(c.lon - 140.146)).toBeLessThan(0.005)
  })
  it('気象庁の時刻（UTC）を ISO にする', () => {
    expect(jmaTimeToIso('20261126101000')).toBe('2026-11-26T10:10:00Z')
  })
  it('アメダスのファイル名は日本時間の3時間区切り・新しい順', () => {
    // 2026-11-26 19:04 JST = 10:04 UTC
    expect(amedasFileTimes(new Date('2026-11-26T10:04:00Z'), 3)).toEqual(['20261126_18', '20261126_15', '20261126_12'])
    // 日をまたぐ（2026-11-27 01:30 JST）
    expect(amedasFileTimes(new Date('2026-11-26T16:30:00Z'), 2)).toEqual(['20261127_00', '20261126_21'])
  })
  it('アメダスの値は品質フラグ0のときだけ採る', () => {
    expect(amedasValue({ p: [1.5, 0] }, 'p')).toBe(1.5)
    expect(amedasValue({ p: [1.5, 1] }, 'p')).toBeNull()
    expect(amedasValue({}, 'p')).toBeNull()
  })
})
