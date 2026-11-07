import { describe, expect, it } from 'vitest'
import {
  childPlaceColumns,
  childPlaceInitialInput,
  childPlaceLabel,
  decideAttendeeColumns,
  isChildPlaceKey,
  normalizeOrganizerName,
  parseChildPlaceTag,
  summarizeChildPlace,
  tagKinds,
  tagLabel,
  type ChildPlaceEventRow,
} from '../child-place'

describe('目印の種類と名前', () => {
  it('key の判定と表示名', () => {
    expect(isChildPlaceKey('ibasho')).toBe(true)
    expect(isChildPlaceKey('oyako')).toBe(true)
    expect(isChildPlaceKey('kodomo')).toBe(false)
    expect(isChildPlaceKey(null)).toBe(false)
    expect(childPlaceLabel('ibasho')).toBe('居場所型')
    expect(childPlaceLabel('oyako')).toBe('親子が集まる場')
    expect(childPlaceLabel(null)).toBe('')
  })
})

describe('?tag= の読み取り', () => {
  it('決まった値だけ通す', () => {
    expect(parseChildPlaceTag('kodomo')).toBe('kodomo')
    expect(parseChildPlaceTag('ibasho')).toBe('ibasho')
    expect(parseChildPlaceTag('oyako')).toBe('oyako')
    expect(parseChildPlaceTag(['ibasho', 'oyako'])).toBe('ibasho')
  })

  it('知らない値・空は絞り込みなし（null）', () => {
    expect(parseChildPlaceTag('bosai')).toBeNull()
    expect(parseChildPlaceTag('')).toBeNull()
    expect(parseChildPlaceTag(undefined)).toBeNull()
    expect(parseChildPlaceTag("kodomo' or 1=1")).toBeNull()
  })

  it('kodomo は両方、ほかは1つ', () => {
    expect(tagKinds('kodomo')).toEqual(['ibasho', 'oyako'])
    expect(tagKinds('ibasho')).toEqual(['ibasho'])
    expect(tagKinds('oyako')).toEqual(['oyako'])
    expect(tagLabel('kodomo')).toBe('子どもの居場所')
    expect(tagLabel('oyako')).toBe('親子が集まる場')
  })
})

describe('フォームの選択 → 列の値', () => {
  it('居場所型・親子の場は人が決めた印つき', () => {
    expect(childPlaceColumns('ibasho')).toEqual({ child_place: 'ibasho', child_place_checked: true })
    expect(childPlaceColumns('oyako')).toEqual({ child_place: 'oyako', child_place_checked: true })
  })

  it('子ども向けではない（none）は null＋人が決めた印（自動判定で付け直されない）', () => {
    expect(childPlaceColumns('none')).toEqual({ child_place: null, child_place_checked: true })
  })

  it('自動（空）や知らない値は何も書かない', () => {
    expect(childPlaceColumns('')).toEqual({})
    expect(childPlaceColumns(undefined)).toEqual({})
    expect(childPlaceColumns('kodomo')).toEqual({})
    expect(childPlaceColumns(null)).toEqual({})
  })

  it('編集画面の初期値：人が決めていなければ自動、決めていればその値（none を含む）', () => {
    expect(childPlaceInitialInput({ child_place: 'ibasho', child_place_checked: false })).toBe('')
    expect(childPlaceInitialInput({ child_place: null, child_place_checked: false })).toBe('')
    expect(childPlaceInitialInput({ child_place: 'oyako', child_place_checked: true })).toBe('oyako')
    expect(childPlaceInitialInput({ child_place: null, child_place_checked: true })).toBe('none')
    expect(childPlaceInitialInput({})).toBe('')
  })
})

describe('団体名の名寄せ', () => {
  it('法人格と空白の違いは同じ団体', () => {
    expect(normalizeOrganizerName('NPO法人 Shake Hands Japan')).toBe(normalizeOrganizerName('Shake Hands Japan'))
    expect(normalizeOrganizerName('特定非営利活動法人 Shake Hands Japan')).toBe('shakehandsjapan')
    expect(normalizeOrganizerName('ＮＰＯ法人　Ｓｈａｋｅ Ｈａｎｄｓ Ｊａｐａｎ')).toBe('shakehandsjapan')
    expect(normalizeOrganizerName('市民活動団体 産前産後ケアINZAI')).toBe('産前産後ケアinzai')
  })

  it('別の団体は別のまま', () => {
    expect(normalizeOrganizerName('印西おやこカフェ ここのわ')).not.toBe(normalizeOrganizerName('みんなのおにわ'))
  })

  it('空・法人格だけのときは空にならない', () => {
    expect(normalizeOrganizerName('')).toBe('')
    expect(normalizeOrganizerName(null)).toBe('')
    expect(normalizeOrganizerName('NPO法人')).toBe('npo法人')
  })
})

describe('実績サマリー', () => {
  // 2026-11-08 12:00 JST
  const NOW = new Date('2026-11-08T03:00:00Z').getTime()
  const row = (start: string, kind: ChildPlaceEventRow['child_place'], org: string | null, checked = false): ChildPlaceEventRow => ({
    start_at: start,
    child_place: kind,
    organizer_name: org,
    child_place_checked: checked,
  })

  const rows: ChildPlaceEventRow[] = [
    row('2026-08-27T01:00:00Z', 'ibasho', 'NPO法人 Shake Hands Japan', true),
    row('2026-09-20T01:00:00Z', 'ibasho', 'Shake Hands Japan', true),
    row('2026-11-15T01:00:00Z', 'ibasho', 'みんなのおにわ'),
    row('2026-09-05T01:00:00Z', 'oyako', '各図書館'),
    row('2026-11-20T01:00:00Z', 'oyako', null),
    row('2026-10-01T01:00:00Z', null, '無関係な主催'),
  ]

  it('目印のない行は数えない', () => {
    const s = summarizeChildPlace(rows, NOW)
    expect(s.total).toBe(5)
  })

  it('過去と今後を分ける（開始時刻が今より前なら過去）', () => {
    const s = summarizeChildPlace(rows, NOW)
    expect(s.past).toBe(3)
    expect(s.upcoming).toBe(2)
    expect(s.byKind.ibasho).toMatchObject({ count: 3, past: 2, upcoming: 1 })
    expect(s.byKind.oyako).toMatchObject({ count: 2, past: 1, upcoming: 1 })
  })

  it('団体数は名寄せして数える（表記ゆれは1団体）・主催不明も1つに数える', () => {
    const s = summarizeChildPlace(rows, NOW)
    expect(s.byKind.ibasho.organizers).toBe(2)
    expect(s.byKind.oyako.organizers).toBe(2)
    expect(s.organizers).toBe(4)
    expect(s.organizerList[0]).toEqual({ name: 'NPO法人 Shake Hands Japan', count: 2 })
    expect(s.organizerList.map((o) => o.name)).toContain('（主催者不明）')
  })

  it('確認済みの件数', () => {
    expect(summarizeChildPlace(rows, NOW).checked).toBe(2)
  })

  it('月別は最初から最後の月まで、空の月も0で並べる（日本時間の月）', () => {
    const s = summarizeChildPlace(rows, NOW)
    expect(s.firstYm).toBe('2026-08')
    expect(s.lastYm).toBe('2026-11')
    expect(s.months).toEqual([
      { ym: '2026-08', ibasho: 1, oyako: 0 },
      { ym: '2026-09', ibasho: 1, oyako: 1 },
      { ym: '2026-10', ibasho: 0, oyako: 0 },
      { ym: '2026-11', ibasho: 1, oyako: 1 },
    ])
  })

  it('日本時間で月をまたぐ開始時刻は日本時間の月に数える', () => {
    // 2026-08-31 16:00 UTC = 2026-09-01 01:00 JST
    const s = summarizeChildPlace([row('2026-08-31T16:00:00Z', 'ibasho', 'a')], NOW)
    expect(s.firstYm).toBe('2026-09')
  })

  it('年をまたぐ月も途切れない', () => {
    const s = summarizeChildPlace([row('2026-12-10T01:00:00Z', 'ibasho', 'a'), row('2027-02-10T01:00:00Z', 'oyako', 'b')], NOW)
    expect(s.months.map((m) => m.ym)).toEqual(['2026-12', '2027-01', '2027-02'])
  })

  it('空のときは0と空', () => {
    const s = summarizeChildPlace([], NOW)
    expect(s).toMatchObject({ total: 0, past: 0, upcoming: 0, organizers: 0, firstYm: null, lastYm: null })
    expect(s.months).toEqual([])
    expect(s.organizerList).toEqual([])
  })

  it('壊れた日時の行は飛ばす', () => {
    expect(summarizeChildPlace([row('not-a-date', 'ibasho', 'a')], NOW).total).toBe(0)
  })
})

describe('参加者数の集計（報告のあった回だけ）', () => {
  const NOW = new Date('2026-11-08T03:00:00Z').getTime()
  const r = (start: string, n: number | null | undefined): ChildPlaceEventRow => ({
    start_at: start,
    child_place: 'ibasho',
    organizer_name: 'a',
    attendee_count: n,
  })

  it('開催日が過ぎた回で報告のあったものだけを合計し、平均は報告のあった回で割る', () => {
    const s = summarizeChildPlace([r('2026-09-01T01:00:00Z', 10), r('2026-09-08T01:00:00Z', 5), r('2026-09-15T01:00:00Z', null)], NOW)
    expect(s.attendance).toEqual({ past: 3, reported: 2, total: 15, average: 7.5 })
  })

  it('0人と報告された回は報告ありとして数える（未報告とは別）', () => {
    const s = summarizeChildPlace([r('2026-09-01T01:00:00Z', 0), r('2026-09-08T01:00:00Z', undefined)], NOW)
    expect(s.attendance).toEqual({ past: 2, reported: 1, total: 0, average: 0 })
  })

  it('これから開かれる回に入っている人数は数えない', () => {
    const s = summarizeChildPlace([r('2026-12-01T01:00:00Z', 30), r('2026-09-01T01:00:00Z', 4)], NOW)
    expect(s.attendance).toEqual({ past: 1, reported: 1, total: 4, average: 4 })
  })

  it('報告が1件もなければ平均は null（0にしない）', () => {
    const s = summarizeChildPlace([r('2026-09-01T01:00:00Z', null)], NOW)
    expect(s.attendance).toEqual({ past: 1, reported: 0, total: 0, average: null })
  })

  it('負の数・数でない値は報告として数えない', () => {
    const s = summarizeChildPlace([r('2026-09-01T01:00:00Z', -3), r('2026-09-02T01:00:00Z', Number.NaN)], NOW)
    expect(s.attendance.reported).toBe(0)
  })
})

describe('参加者数を保存するときの決まり（decideAttendeeColumns）', () => {
  const NOW = new Date('2026-11-08T03:00:00Z').getTime()
  const PAST = new Date('2026-09-20T02:00:00Z').getTime()
  const FUTURE = new Date('2026-12-01T02:00:00Z').getTime()
  const base = { startMs: PAST, nowMs: NOW, currentCount: null as number | null, isAdmin: false }

  it('入力欄がなかった（undefined）なら何も書かない', () => {
    expect(decideAttendeeColumns({ ...base, count: undefined })).toEqual({})
  })

  it('空にして保存（null）すると未報告に戻す（出どころも消す）', () => {
    expect(decideAttendeeColumns({ ...base, count: null, currentCount: 12 })).toEqual({ attendee_count: null, attendee_count_source: null })
  })

  it('主催者・登録者が入れたら organizer、運営が入れたら operator', () => {
    expect(decideAttendeeColumns({ ...base, count: 25 })).toEqual({ attendee_count: 25, attendee_count_source: 'organizer' })
    expect(decideAttendeeColumns({ ...base, count: 25, isAdmin: true })).toEqual({ attendee_count: 25, attendee_count_source: 'operator' })
  })

  it('0人も報告として保存できる', () => {
    expect(decideAttendeeColumns({ ...base, count: 0 })).toEqual({ attendee_count: 0, attendee_count_source: 'organizer' })
  })

  it('今と同じ人数なら出どころを変えない（運営が編集画面を開いて保存しただけでは『運営』にならない）', () => {
    expect(decideAttendeeColumns({ ...base, count: 25, currentCount: 25, isAdmin: true })).toEqual({})
  })

  it('人数が変わったら、そのときの入力者に出どころを付け替える', () => {
    expect(decideAttendeeColumns({ ...base, count: 30, currentCount: 25, isAdmin: true })).toEqual({ attendee_count: 30, attendee_count_source: 'operator' })
  })

  it('開始時刻の前のイベントには入れられない', () => {
    expect(() => decideAttendeeColumns({ ...base, count: 10, startMs: FUTURE })).toThrow('開始時刻を過ぎた')
  })

  it('整数でない・負・大きすぎる値は断る', () => {
    for (const bad of [1.5, -1, 100001, Number.NaN]) {
      expect(() => decideAttendeeColumns({ ...base, count: bad })).toThrow('0〜100000の整数')
    }
  })
})
