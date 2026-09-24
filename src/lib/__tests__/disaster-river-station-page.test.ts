// 千葉県 水防情報「水位グラフ」個別ページの読み取り（基準水位と10分値）。
// 見本の HTML は県のページの形（1行に「HH時の6値」）を縮めたもの。

import { describe, expect, it } from 'vitest'
import { parseStationPage, type Levels } from '@/lib/disaster-river-station-page'

const FALLBACK: Levels = { standby: 9.1, caution: 9.2, danger: 9.3, planHigh: 9.4 }

const levelRow = (label: string, value: string) => `<tr><th>${label}</th><td>&nbsp;${value}</td></tr>`
const hourRow = (hour: string, cells: string[]) => `<tr><th class="title">${hour}</th>${cells.map((c) => `<td class="data">${c}</td>`).join('')}</tr>`
const page = (levels: string[], rows: string[]) =>
  `<html><body><p>2026年09月21日 観測</p><table>${levels.join('')}</table><table>${rows.join('')}</table></body></html>`

describe('parseStationPage：基準水位', () => {
  it('「はん濫危険水位 ---」のとき、次の行の注意水位を危険水位として拾わない', () => {
    // 印旛沼のページの形：危険水位が「---」で、そのすぐ後に注意水位の数字がある
    const html = page([
      levelRow('水防団待機水位', '2.80m'),
      levelRow('はん濫危険水位', '---'),
      levelRow('はん濫注意水位', '3.40m'),
      levelRow('計画高水位相当', '4.25m'),
    ], [])
    const { levels } = parseStationPage(html, FALLBACK)
    expect(levels.danger).toBeNull()        // 3.40 を拾わず、予備値 9.3 にも戻さない
    expect(levels.caution).toBe(3.4)
    expect(levels).toEqual({ standby: 2.8, caution: 3.4, danger: null, planHigh: 4.25 })
  })

  it('ラベル自体が無いときは予備の基準値を使う', () => {
    // ページの形が変わって基準水位の表が無い → config の予備値
    const { levels } = parseStationPage(page([], []), FALLBACK)
    expect(levels).toEqual(FALLBACK)
  })
})

describe('parseStationPage：10分値', () => {
  it('0.00 と *** は欠測として読み飛ばす', () => {
    // 00分=0.00・10分=***・30分=空欄・40分=--- は捨て、20分と50分だけを採る
    const html = page([], [hourRow('01', ['0.00', '***', '2.51', '&nbsp;', '---', '2.53'])])
    const { readings } = parseStationPage(html, FALLBACK)
    expect(readings).toEqual([
      { time: '2026-09-21T01:20:00+09:00', level: 2.51 },
      { time: '2026-09-21T01:50:00+09:00', level: 2.53 },
    ])
  })

  it('深夜に 0.00 が続いても、最新の有効な値が最後に来る', () => {
    // 2026-09-21 深夜の実例：23時台が 0.00 だらけでも、22時台の値が最新として残る
    const html = page([], [
      hourRow('22', ['3.10', '3.11', '3.12', '3.13', '3.14', '3.15']),
      hourRow('23', ['0.00', '0.00', '0.00', '***', '***', '***']),
    ])
    const { readings } = parseStationPage(html, FALLBACK)
    expect(readings).toHaveLength(6)
    expect(readings.at(-1)).toEqual({ time: '2026-09-21T22:50:00+09:00', level: 3.15 })
  })

  it('観測日が読めなければ例外', () => {
    // 日付が無いページ（メンテナンス画面など）を今日の値として扱わない
    expect(() => parseStationPage('<html>メンテナンス中</html>', FALLBACK)).toThrow('観測日')
  })
})
