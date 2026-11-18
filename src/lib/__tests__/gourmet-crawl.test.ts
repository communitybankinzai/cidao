// 食レポの SNS 巡回：照合と候補づくり（2026-11-13）
import { describe, expect, it } from 'vitest'
import { addressKey, buildCandidateShops, captionHash, hintIsOutOfRange, matchShop, matchShopByAddress, normShopName, type ShopEntry } from '@/lib/gourmet-crawl'

const shop = (ref: string, name: string, municipality = '印西市', area: 'inzai' | 'near' = 'inzai', extra: Partial<ShopEntry> = {}): ShopEntry =>
  ({ ref, name, lat: 35.8, lon: 140.15, area, municipality, ...extra })

const SHOPS: ShopEntry[] = [
  shop('osm:n1', 'ラーメン'),
  shop('poi:000000000001', '茶房 宮﨑邸'),
  shop('poi:000000000002', '彦兵衛', '白井市', 'near'),
  shop('osm:n2', 'ごま福堂', '成田市', 'near'),
  shop('poi:000000000003', 'スープパスタ&PIZZA専門店 東京オリーブ 千葉ニュータウン駅前'),
  shop('osm:n3', 'すき家', '印西市'),
  shop('osm:n4', 'すき家', '佐倉市', 'near'),
]

describe('照合', () => {
  it('正規化はカタカナ・全角・記号をそろえる', () => {
    expect(normShopName('ＴＨＥ・スパイス クラブ！')).toBe(normShopName('the すぱいすくらぶ'))
  })
  it('一般的な語だけの店名（ラーメン）には当てない（2026-11-13 の試験の取り違え）', () => {
    expect(matchShop('つけ麺らーめん春樹 BIG HOPガーデンモール印西店', '印西市原', SHOPS)).toEqual([])
  })
  it('地図の店名の中にある短い名前（宮﨑邸）・後ろにある名前（彦兵衛）・先頭がそろう名前（ごま福堂 成田店）を当てる', () => {
    expect(matchShop('宮﨑邸', '印西市船尾', SHOPS)[0]?.ref).toBe('poi:000000000001')
    expect(matchShop('十割蕎麦 彦兵衛', '白井市根', SHOPS)[0]?.ref).toBe('poi:000000000002')
    expect(matchShop('ごま福堂 成田店', '成田', SHOPS)[0]?.ref).toBe('osm:n2')
    expect(matchShop('東京オリーブ', '千葉ニュータウン', SHOPS)[0]?.ref).toBe('poi:000000000003')
  })
  it('同名のチェーン店は地域の手がかりで上げる', () => {
    expect(matchShop('すき家', '佐倉市', SHOPS)[0]?.ref).toBe('osm:n4')
  })
  it('範囲外の市町の手がかり', () => {
    expect(hintIsOutOfRange('東京都新宿区')).toBe(true)
    expect(hintIsOutOfRange('八千代市ゆりのき台')).toBe(false) // 県内のその他は足切りしない（2026-11-14）
    expect(hintIsOutOfRange('印西市高花')).toBe(false)
    expect(hintIsOutOfRange('白井駅近く、船橋市神保町')).toBe(false) // 範囲内の名前も出ていれば外さない（照合に任せる）
  })
})

describe('候補づくり', () => {
  const ex = (shops: Array<{ name: string; area_hint?: string; tone?: 'positive' | 'neutral' | 'negative' }>, food = true) => ({
    is_food_report: food, more_than_10: false, note: '',
    shops: shops.map((s) => ({ name: s.name, area_hint: s.area_hint ?? '', tone: s.tone ?? 'positive', confidence: 'high' as const, reason: '' })),
  })
  it('批判的なお店はそのお店だけ外す（投稿全体はまとめて判定しない）', () => {
    const c = buildCandidateShops(ex([{ name: '宮﨑邸', area_hint: '印西' }, { name: 'ごま福堂', area_hint: '成田', tone: 'negative' }]), SHOPS)
    expect(c.map((s) => s.status)).toEqual(['ok', 'negative'])
  })
  it('範囲外は外し、地図にないお店は「地図にないお店」で残す', () => {
    const c = buildCandidateShops(ex([{ name: 'お好み焼き どんどん', area_hint: '東京都新宿区' }, { name: 'スナヲめし', area_hint: '印西市高花' }]), SHOPS)
    expect(c.map((s) => s.status)).toEqual(['out_of_area', 'unmatched'])
    expect(c[1].chosen_ref).toBeNull()
  })
  it('同点（チェーン店で手がかりが無い）は自動で選ばず、運営に選んでもらう', () => {
    const c = buildCandidateShops(ex([{ name: 'すき家' }]), SHOPS)
    expect(c[0].matches.length).toBe(2)
    expect(c[0].chosen_ref).toBeNull()
  })
  it('食レポでない投稿からは何も作らない', () => {
    expect(buildCandidateShops(ex([{ name: '宮﨑邸' }], false), SHOPS)).toEqual([])
  })
  it('本文はハッシュだけ（空白の違いは同じ）', () => {
    expect(captionHash('おいしい  ランチ')).toBe(captionHash('おいしい ランチ'))
    expect(captionHash('a')).toHaveLength(64)
  })
})

describe('店名が無く住所だけの投稿（2026-11-19）', () => {
  const ADDR: ShopEntry[] = [
    shop('poi:0000000000a1', 'Bakery Cornet', '印西市', 'inzai', { address: '千葉県印西市Nishinohara, 2 Chome−５−22' }),
    shop('poi:0000000000a2', '大海飯店 カスミ印西西の原店', '印西市', 'inzai', { address: '千葉県印西市西の原２－２－２' }),
    shop('poi:0000000000a3', 'べつの店', '白井市', 'near', { address: '千葉県白井市根2-5-22' }),
  ]
  const ex = (name: string, area_hint: string) => ({
    is_food_report: true, more_than_10: false, note: '',
    shops: [{ name, area_hint, tone: 'positive' as const, confidence: 'mid' as const, reason: '' }],
  })
  it('住所から町名と番地を取り出す（丁目・全角・英字の表記をそろえる）', () => {
    expect(addressKey('千葉県印西市西の原2-5-22')).toEqual({ town: '西の原', nums: '2-5-22' })
    expect(addressKey('印西市西の原二丁目5番22号')).toEqual({ town: '西の原', nums: '2-5-22' })
    expect(addressKey('千葉県印西市Nishinohara, 2 Chome−５−22')).toEqual({ town: null, nums: '2-5-22' })
    expect(addressKey('印西市')).toBeNull()
  })
  it('町名と番地が合えば自動で選ぶ／番地と市だけなら候補に出して運営が選ぶ', () => {
    expect(matchShopByAddress('千葉県印西市西の原2-2-2', ADDR)[0]).toMatchObject({ ref: 'poi:0000000000a2', score: 90 })
    const m = matchShopByAddress('千葉県印西市西の原2-5-22', ADDR)
    expect(m.map((x) => x.ref)).toEqual(['poi:0000000000a1']) // 白井市の同じ番地は出さない
    expect(m[0].score).toBe(70)
  })
  it('店名なし・住所ありは候補に残す（以前は落としていた）', () => {
    const c = buildCandidateShops(ex('', '千葉県印西市西の原2-5-22'), ADDR)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ name: '店名なし（千葉県印西市西の原2-5-22）', status: 'ok', chosen_ref: null })
    const d = buildCandidateShops(ex('', '千葉県印西市西の原2-2-2'), ADDR)
    expect(d[0].chosen_ref).toBe('poi:0000000000a2')
    const u = buildCandidateShops(ex('', '千葉県印西市大森1-2-3'), ADDR)
    expect(u[0].status).toBe('unmatched')
  })
  it('店名も番地も無いお店は、これまでどおり入れない', () => {
    expect(buildCandidateShops(ex('', '印西'), ADDR)).toEqual([])
  })
})
