import { describe, expect, it } from 'vitest'
import { displayHouseholds, parseTeidenTime, parseTeidenXml } from '@/lib/tepco-teiden'

// 2026-09-28 に取得した印西市 XML（停電なし）と同じ形
const NONE = `<?xml version="1.0" encoding="UTF-8" ?>
<東京電力停電情報>
	<タイトル>印西市</タイトル>
	<お知らせ1></お知らせ1>
	<お知らせ13>周辺地域の停電が復旧しているにもかかわらず…</お知らせ13>
	<更新日時>202609281419</更新日時>
</東京電力停電情報>`

// 停電があるときの形（東電の address-city.js が読む要素から組み立てた試験用の値・実データではない）
const SOME = `<?xml version="1.0" encoding="UTF-8" ?>
<東京電力停電情報>
	<タイトル>印西市</タイトル>
	<停電軒数>905</停電軒数>
	<エリア コード="12231001000"><名前>大森</名前><停電軒数>900</停電軒数></エリア>
	<エリア コード="12231002000"><名前>竹袋</名前><停電軒数>5</停電軒数></エリア>
	<エリア コード="12231003000"><名前>木下</名前><停電軒数></停電軒数></エリア>
	<地域詳細情報>倒木の影響</地域詳細情報>
	<更新日時>202609281530</更新日時>
</東京電力停電情報>`

describe('tepco-teiden', () => {
  it('停電が無いときは地区も合計も空で、更新日時だけ返す', () => {
    const r = parseTeidenXml(NONE)
    expect(r.title).toBe('印西市')
    expect(r.areas).toEqual([])
    expect(r.total).toBeNull()
    expect(r.updatedAt).toBe('2026-09-28T14:19:00+09:00')
  })

  it('地区ごとの軒数を東電の表示どおりに返し、軒数が空の地区は出さない', () => {
    const r = parseTeidenXml(SOME)
    expect(r.total).toEqual({ households: 905, display: '約905軒' })
    expect(r.areas).toEqual([
      { code: '12231001000', district: '大森', households: 900, display: '約900軒' },
      { code: '12231002000', district: '竹袋', households: 5, display: '10軒未満' },
    ])
    expect(r.detail).toBe('倒木の影響')
  })

  it('表示の規則は東電の画面と同じ', () => {
    expect(displayHouseholds(9)).toBe('10軒未満')
    expect(displayHouseholds(10)).toBe('約10軒')
  })

  it('形が違うものは例外にする', () => {
    expect(() => parseTeidenXml('<html>サービス停止</html>')).toThrow('unexpected_format')
    expect(parseTeidenTime('2026/09/28')).toBeNull()
  })
})
