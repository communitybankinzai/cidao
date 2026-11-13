// 食レポの候補：地域の区分・絞り込み（2026-11-13）
import { describe, expect, it } from 'vitest'
import { areaVisible, candidateAreaClass, hintAreaClass, hintIsOutOfRange } from '../gourmet-area-class'

describe('hintAreaClass', () => {
  it('印西市・千葉ニュータウン・牧の原は市内', () => {
    expect(hintAreaClass('千葉県印西市中央北1-4 アルカサール内、千葉ニュータウン中央駅近く')).toBe('inzai')
    expect(hintAreaClass('牧の原駅前')).toBe('inzai')
  })
  it('周辺6市町は near', () => {
    for (const h of ['白井市復', '栄町安食', '柏市柏の葉', '我孫子市', '成田市花崎町', '佐倉市ユーカリが丘']) expect(hintAreaClass(h)).toBe('near')
  })
  it('旭市・香取市・匝瑳市・八千代市などは県内のその他（pref）、東京・茨城は県外（out）', () => {
    for (const h of ['千葉県旭市飯岡', '香取市小見川', '匝瑳市平木、JR八日市場駅', '八千代市ゆりのき台']) expect(hintAreaClass(h)).toBe('pref')
    for (const h of ['東京都新宿区', '茨城県取手市']) expect(hintAreaClass(h)).toBe('out')
  })
  it('手がかりが無い・町名だけなら unknown。「千葉県」だけでは範囲外にしない', () => {
    expect(hintAreaClass('')).toBe('unknown')
    expect(hintAreaClass(null)).toBe('unknown')
    expect(hintAreaClass('中央駅前')).toBe('unknown')
    expect(hintAreaClass('千葉県')).toBe('unknown')
  })
  it('範囲内の名前も同時に出ていれば範囲内（内側を優先）', () => {
    expect(hintAreaClass('白井駅近く、船橋市神保町')).toBe('near')
    expect(hintAreaClass('船橋市と印西市の境')).toBe('inzai')
    expect(hintIsOutOfRange('白井駅近く、船橋市神保町')).toBe(false)
  })
})

describe('candidateAreaClass と areaVisible', () => {
  const shop = (status: string, area_hint: string, area?: string) => ({ status, area_hint, matches: area ? [{ area }] : [] })
  it('複数店の投稿は、いちばん内側のお店の区分', () => {
    expect(candidateAreaClass([shop('out_of_area', '旭市'), shop('unmatched', '印西市中央北')])).toBe('inzai')
    expect(candidateAreaClass([shop('out_of_area', '旭市'), shop('out_of_area', '八千代市')])).toBe('pref')
    expect(candidateAreaClass([shop('out_of_area', '東京都新宿区'), shop('out_of_area', '茨城県取手市')])).toBe('out')
  })
  it('照合できたお店は、地図のお店の area を使う', () => {
    expect(candidateAreaClass([shop('ok', '', 'near')])).toBe('near')
    expect(candidateAreaClass([shop('ok', '', 'inzai')])).toBe('inzai')
  })
  it('お店が無ければ unknown', () => {
    expect(candidateAreaClass([])).toBe('unknown')
  })
  it('既定（市内のみ）は市内と不明を見せ、周辺と範囲外は隠す。周辺まで／すべてで広がる', () => {
    expect(areaVisible('inzai', 'inzai')).toBe(true)
    expect(areaVisible('unknown', 'inzai')).toBe(true)
    expect(areaVisible('near', 'inzai')).toBe(false)
    expect(areaVisible('out', 'inzai')).toBe(false)
    expect(areaVisible('near', 'near')).toBe(true)
    expect(areaVisible('out', 'near')).toBe(false)
    expect(areaVisible('pref', 'near')).toBe(false)
    expect(areaVisible('pref', 'pref')).toBe(true)
    expect(areaVisible('out', 'pref')).toBe(false)
    expect(areaVisible('out', 'all')).toBe(true)
  })
})
