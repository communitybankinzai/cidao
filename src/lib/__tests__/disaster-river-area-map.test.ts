// 千葉県「水位状況図（印旛地域）」1ページから、入口・出口の観測所を読み取るテスト。
// 実際のページ（2026-09-24 00:10 時点）の div をそのまま使う。

import { describe, expect, it } from 'vitest'
import { parseAreaMap } from '@/app/api/disaster/river-level/route'

const HTML = [
  '<div id="river63" na="馬渡" time="09/24&nbsp;00：10" suii="&darr;  &nbsp;&nbsp;&nbsp;&nbsp;1.35[m]" sitei="&nbsp;&nbsp;&nbsp;&nbsp;1.30[m]" keikai="&nbsp;&nbsp;&nbsp;&nbsp;2.80[m]" kiken="&nbsp;" keikaku="&nbsp;&nbsp;&nbsp;&nbsp;4.10[m]" flag="水防団待機値超過" style="position:absolute;left:1px;top:2px">',
  '<div id="river68" na="鏑木橋" time="09/24&nbsp;00：10" suii="&darr;  &nbsp;&nbsp;&nbsp;&nbsp;3.95[m]" sitei="&nbsp;&nbsp;&nbsp;&nbsp;3.50[m]" keikai="&nbsp;&nbsp;&nbsp;&nbsp;4.00[m]" kiken="&nbsp;&nbsp;&nbsp;&nbsp;4.80[m]" keikaku="&nbsp;&nbsp;&nbsp;&nbsp;4.80[m]" flag="水防団待機値超過" style="position:absolute;left:1px;top:2px">',
  '<div id="river116" na="大和田外水位" time="09/24&nbsp;00：10" suii="&rarr;  &nbsp;&nbsp;&nbsp;&nbsp;6.97[m]" sitei="&nbsp;" keikai="&nbsp;" kiken="&nbsp;" keikaku="&nbsp;" flag="通常" style="position:absolute;left:1px;top:2px">',
  '<div id="river125" na="大草" time="09/24&nbsp;00：10" suii="&rarr;  &nbsp;&nbsp;&nbsp;-0.13[m]" sitei="&nbsp;&nbsp;&nbsp;&nbsp;0.90[m]" keikai="&nbsp;&nbsp;&nbsp;&nbsp;1.50[m]" kiken="&nbsp;" keikaku="&nbsp;&nbsp;&nbsp;&nbsp;2.23[m]" flag="通常" style="position:absolute;left:1px;top:2px">',
  '<div id="river30" na="成東" time="09/23&nbsp;24：00" suii="***[m]" sitei="&nbsp;&nbsp;&nbsp;&nbsp;5.06[m]" keikai="&nbsp;" kiken="&nbsp;" keikaku="&nbsp;" flag="欠測" style="position:absolute;left:1px;top:2px">',
].join('\n')

const NOW = new Date('2026-09-24T00:20:00+09:00')

describe('parseAreaMap', () => {
  it('鹿島川（馬渡）の水位・基準・下降の向きを読む', () => {
    const st = parseAreaMap(HTML, NOW).get(63)
    expect(st).toEqual({
      level: 1.35,
      time: '2026-09-24T00:10:00+09:00',
      trend: 'down',
      levels: { standby: 1.3, caution: 2.8, danger: null, planHigh: 4.1 },
    })
  })

  it('高崎川（鏑木橋）のはん濫危険水位も読む', () => {
    expect(parseAreaMap(HTML, NOW).get(68)?.levels).toEqual({ standby: 3.5, caution: 4, danger: 4.8, planHigh: 4.8 })
  })

  it('大和田の外水位は基準がひとつも無い（「平常」と言い切れない局）', () => {
    const st = parseAreaMap(HTML, NOW).get(116)
    expect(st?.level).toBe(6.97)
    expect(st?.levels).toEqual({ standby: null, caution: null, danger: null, planHigh: null })
    expect(Object.values(st!.levels).some((v) => v !== null)).toBe(false)
  })

  it('マイナスの水位も読む', () => {
    expect(parseAreaMap(HTML, NOW).get(125)?.level).toBe(-0.13)
  })

  it('欠測（***）は水位なしとして返す', () => {
    expect(parseAreaMap(HTML, NOW).get(30)?.level).toBeNull()
  })

  it('年をまたぐとき、先の日付は前の年とみなす', () => {
    const html = '<div id="river63" na="馬渡" time="12/31&nbsp;23：50" suii="&rarr;  1.00[m]" sitei="&nbsp;" keikai="&nbsp;" kiken="&nbsp;" keikaku="&nbsp;" flag="通常">'
    const st = parseAreaMap(html, new Date('2027-01-01T00:05:00+09:00')).get(63)
    expect(st?.time).toBe('2026-12-31T23:50:00+09:00')
  })
})
