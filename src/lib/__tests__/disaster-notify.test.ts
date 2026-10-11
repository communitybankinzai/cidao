import { describe, expect, it } from 'vitest'
import { classifyTimelineDraft, DISASTER_CATEGORIES } from '@/lib/disaster-notify'

describe('classifyTimelineDraft', () => {
  it('気象庁の警報（発表）は warning、特別警報は見出しを変える', () => {
    const a = classifyTimelineDraft('jma-warning', { title: '印西市：大雨警報（発表）、洪水注意報（継続）' })
    expect(a?.category).toBe('warning')
    expect(a?.title).toContain('警報')
    const s = classifyTimelineDraft('jma-warning', { title: '印西市：大雨特別警報（発表）' })
    expect(s?.title).toContain('特別警報')
  })

  it('注意報だけ・継続・解除は対象外', () => {
    expect(classifyTimelineDraft('jma-warning', { title: '印西市：大雨注意報（発表）' })).toBeNull()
    expect(classifyTimelineDraft('jma-warning', { title: '印西市：大雨警報（継続）' })).toBeNull()
    expect(classifyTimelineDraft('jma-warning', { title: '印西市：発表中の警報・注意報なし（解除）', changeType: 'cancel' })).toBeNull()
  })

  it('市の避難情報はレベルを付け、解除は対象外', () => {
    const r4 = classifyTimelineDraft('city-alert-xml', { title: '避難指示を発令しました', body: '印旛沼周辺の低い土地' })
    expect(r4?.category).toBe('evac')
    expect(r4?.title).toContain('レベル4')
    const r3 = classifyTimelineDraft('city-category-html', { title: '高齢者等避難を発令' })
    expect(r3?.title).toContain('レベル3')
    const r5 = classifyTimelineDraft('city-alert-xml', { title: '緊急安全確保を発令' })
    expect(r5?.title).toContain('レベル5')
    expect(classifyTimelineDraft('city-alert-xml', { title: '避難指示を解除しました' })).toBeNull()
  })

  it('対象外の情報源・内容は null', () => {
    expect(classifyTimelineDraft('jma-quake', { title: '地震情報 震度3' })).toBeNull()
    expect(classifyTimelineDraft('city-alert-xml', { title: '避難所を開設しました' })).toBeNull()
  })

  it('設定の種類は5つで、キーが重複しない', () => {
    const keys = DISASTER_CATEGORIES.map((c) => c.prefKey)
    expect(new Set(keys).size).toBe(5)
    expect(keys.every((k) => k.startsWith('notify_disaster_'))).toBe(true)
  })
})
