import { describe, expect, it } from 'vitest'
import {
  HOSPITALS,
  HOSPITAL_DAY_FILTERS,
  HOSPITAL_FILTERS,
  HOSPITAL_OPEN_MARKS,
  matchesHospitalDay,
  matchesHospitalFilter,
  sortHospitalsForDay,
  type HospitalDayKey,
} from '@/lib/hospitals'

// 病院マップの曜日の絞り込み（2026-11-23・A案）
describe('病院マップ：曜日の絞り込み', () => {
  it('印の付いた医療機関は、すべて一覧にある（印だけが残っていない）', () => {
    const ids = new Set(HOSPITALS.map((h) => h.id))
    for (const id of Object.keys(HOSPITAL_OPEN_MARKS)) expect(ids.has(id), id).toBe(true)
  })

  it('曜日ごとの件数は、印の数と同じ', () => {
    for (const d of HOSPITAL_DAY_FILTERS) {
      const marked = Object.values(HOSPITAL_OPEN_MARKS).filter((m) => m[d.key]).length
      expect(HOSPITALS.filter((h) => matchesHospitalDay(h, d.key)).length).toBe(marked)
      expect(marked).toBeGreaterThan(0)
    }
  })

  it('印の無い医療機関は、どの曜日にも当てはまらない', () => {
    const none = HOSPITALS.find((h) => !HOSPITAL_OPEN_MARKS[h.id])
    expect(none).toBeTruthy()
    for (const d of HOSPITAL_DAY_FILTERS) expect(matchesHospitalDay(none!, d.key)).toBe(false)
  })

  it('並び：診療（●）が上、要確認（▲）が下。同じ印どうしは元の順', () => {
    for (const d of HOSPITAL_DAY_FILTERS) {
      const day: HospitalDayKey = d.key
      const list = HOSPITALS.filter((h) => matchesHospitalDay(h, day))
      const sorted = sortHospitalsForDay(list, day)
      expect(sorted.length).toBe(list.length)
      const marks = sorted.map((h) => HOSPITAL_OPEN_MARKS[h.id]![day])
      const firstT = marks.indexOf('t')
      if (firstT !== -1) expect(marks.slice(firstT).every((m) => m === 't')).toBe(true)
      // 同じ印の中では、元の一覧の順を保つ
      for (const mark of ['o', 't'] as const) {
        const before = list.filter((h) => HOSPITAL_OPEN_MARKS[h.id]![day] === mark).map((h) => h.id)
        const after = sorted.filter((h) => HOSPITAL_OPEN_MARKS[h.id]![day] === mark).map((h) => h.id)
        expect(after).toEqual(before)
      }
    }
  })

  it('診療科と曜日を掛け合わせると、両方に当てはまる所だけになる', () => {
    const both = HOSPITALS.filter((h) => matchesHospitalFilter(h, 'naika') && matchesHospitalDay(h, 'satPm'))
    expect(both.length).toBeGreaterThan(0)
    expect(both.length).toBeLessThan(HOSPITALS.filter((h) => matchesHospitalFilter(h, 'naika')).length)
    for (const h of both) {
      expect(h.kind).not.toBe('歯科')
      expect(HOSPITAL_OPEN_MARKS[h.id]?.satPm).toBeTruthy()
    }
  })

  it('診療科のボタンに、曜日のボタン（日曜・祝日に診療）は混ざっていない', () => {
    expect(HOSPITAL_FILTERS.some((f) => f.key === 'holiday')).toBe(false)
  })
})
