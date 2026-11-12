// 食レポの候補：地図にないお店を足して承認する処理の入力検査（2026-11-13）
import { describe, expect, it } from 'vitest'
import { CandidateError, checkNewShop, findSameShop } from '../gourmet-candidates'

const INZAI = { lat: 35.8001, lon: 140.1331 } // 千葉ニュータウン中央駅のあたり（印西市内）
const TOKYO = { lat: 35.68, lon: 139.76 }

describe('checkNewShop', () => {
  it('名前と範囲内の位置があれば通し、名前の空白を整え、位置を丸める', () => {
    const r = checkNewShop({ name: '  そば処   さつき ', address: ' 印西市牧の原 ', ...INZAI })
    expect(r).toEqual({ name: 'そば処 さつき', address: '印西市牧の原', lat: 35.8001, lon: 140.1331 })
  })
  it('住所は空でもよい', () => {
    expect(checkNewShop({ name: 'さつき', address: '', ...INZAI }).address).toBeNull()
  })
  it('名前なし・長すぎる名前・長すぎる住所は断る', () => {
    expect(() => checkNewShop({ name: '  ', ...INZAI })).toThrow(CandidateError)
    expect(() => checkNewShop({ name: 'あ'.repeat(61), ...INZAI })).toThrow(CandidateError)
    expect(() => checkNewShop({ name: 'さつき', address: 'あ'.repeat(101), ...INZAI })).toThrow(/住所/)
  })
  it('範囲の外（東京など）・数でない位置は断る', () => {
    expect(() => checkNewShop({ name: 'さつき', ...TOKYO })).toThrow(/範囲の外/)
    expect(() => checkNewShop({ name: 'さつき', lat: 'x', lon: 140.13 })).toThrow(/範囲の外/)
    expect(() => checkNewShop({ name: 'さつき', lat: NaN, lon: NaN })).toThrow(CandidateError)
  })
})

describe('findSameShop', () => {
  const shops = [{ id: 'a', name: 'さつき', ...INZAI }, { id: 'b', name: 'ほか', ...INZAI }]
  it('同じ名前で100m以内なら、そのお店を使う', () => {
    expect(findSameShop(shops, 'さつき', INZAI.lat + 0.0005, INZAI.lon)?.id).toBe('a') // 約55m
  })
  it('同じ名前でも100mより離れていれば別のお店', () => {
    expect(findSameShop(shops, 'さつき', INZAI.lat + 0.002, INZAI.lon)).toBeUndefined() // 約222m
  })
  it('近くても名前が違えば別のお店', () => {
    expect(findSameShop(shops, 'ちがう店', INZAI.lat, INZAI.lon)).toBeUndefined()
  })
})
