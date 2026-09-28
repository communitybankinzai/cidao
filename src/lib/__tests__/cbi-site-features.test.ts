// 防災MAPの「押された機能の回数」の受け口：送られた回数と表示名の検査
import { describe, expect, it } from 'vitest'
import { sanitizeFeatureCounts } from '@/lib/cbi-site-features'

describe('sanitizeFeatureCounts', () => {
  it('正の整数の回数と、回数のある機能の表示名だけを残す', () => {
    expect(sanitizeFeatureCounts({ '#legend-range': 2, 'layer:kansui': 1 }, { '#legend-range': '⏱ 期間', 'other': 'x' }))
      .toEqual({ counts: { '#legend-range': 2, 'layer:kansui': 1 }, labels: { '#legend-range': '⏱ 期間' } })
    expect(sanitizeFeatureCounts({}, undefined)).toEqual({ counts: {}, labels: {} })
  })

  it('おかしな回数・長すぎる名前・制御文字・多すぎる機能は全体を断る', () => {
    expect(sanitizeFeatureCounts({ a: 0 }, {})).toBeNull()
    expect(sanitizeFeatureCounts({ a: 1.5 }, {})).toBeNull()
    expect(sanitizeFeatureCounts({ a: 999999 }, {})).toBeNull()
    expect(sanitizeFeatureCounts({ ['x'.repeat(81)]: 1 }, {})).toBeNull()
    expect(sanitizeFeatureCounts({ 'a\nb': 1 }, {})).toBeNull()
    expect(sanitizeFeatureCounts(Object.fromEntries(Array.from({ length: 121 }, (_, i) => [`k${i}`, 1])), {})).toBeNull()
    expect(sanitizeFeatureCounts([1, 2], {})).toBeNull()
  })

  it('長すぎる表示名は捨てる（回数は残す）', () => {
    expect(sanitizeFeatureCounts({ a: 1 }, { a: 'あ'.repeat(41) })).toEqual({ counts: { a: 1 }, labels: {} })
  })
})
