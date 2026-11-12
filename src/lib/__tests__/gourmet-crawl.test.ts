// 食レポの SNS 巡回：照合と候補づくり（2026-11-13）
import { describe, expect, it } from 'vitest'
import { buildCandidateShops, captionHash, hintIsOutOfRange, matchShop, normShopName, type ShopEntry } from '@/lib/gourmet-crawl'

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
    expect(hintIsOutOfRange('八千代市ゆりのき台')).toBe(true)
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
    const c = buildCandidateShops(ex([{ name: 'お好み焼き どんどん', area_hint: '八千代市' }, { name: 'スナヲめし', area_hint: '印西市高花' }]), SHOPS)
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
