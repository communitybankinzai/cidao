import { describe, expect, it } from 'vitest'
import { classifyFireIncident, classifyTimelineDraft, DISASTER_CATEGORIES } from '@/lib/disaster-notify'

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

  it('設定の種類は6つで、キーが重複しない', () => {
    const keys = DISASTER_CATEGORIES.map((c) => c.prefKey)
    expect(new Set(keys).size).toBe(6)
    expect(keys.every((k) => k.startsWith('notify_disaster_'))).toBe(true)
  })
})

describe('classifyFireIncident', () => {
  const now = Date.parse('2026-10-14T00:00:00Z')
  const recent = '2026-10-13T23:00:00Z'
  const base = { id: 'abc', status: 'active', receivedAtIso: recent }

  it('火災・調査活動・事故の active は通知文面になる（印西市を補い、白井市は補わない）', () => {
    const f = classifyFireIncident({ ...base, kind: 'fire', addressText: '浦部2213番氏神' }, now)
    expect(f?.title).toBe('🔥 消防情報（火災）：印西市浦部2213番氏神付近')
    expect(f?.dedupeKey).toBe('abc')
    expect(classifyFireIncident({ ...base, kind: 'investigating', addressText: '戸神台1丁目' }, now)?.title).toContain('調査活動')
    expect(classifyFireIncident({ ...base, kind: 'accident', addressText: '白井市復1449番' }, now)?.title).toContain('：白井市復1449番付近')
  })

  it('救急支援・解除済み・3時間より古い・idなしは対象外', () => {
    expect(classifyFireIncident({ ...base, kind: 'ems', addressText: 'x' }, now)).toBeNull()
    expect(classifyFireIncident({ ...base, kind: 'fire', status: 'cleared' }, now)).toBeNull()
    expect(classifyFireIncident({ ...base, kind: 'fire', receivedAtIso: '2026-10-13T20:00:00Z' }, now)).toBeNull()
    expect(classifyFireIncident({ ...base, id: undefined, kind: 'fire' }, now)).toBeNull()
  })
})

