import { describe, expect, it } from 'vitest'
import {
  buildEventReminder,
  formatJstShort,
  nextJstDayWindow,
  pickReminderRecipients,
  reminderLink,
} from '@/lib/event-reminder'

describe('nextJstDayWindow（あした1日分の窓）', () => {
  it('朝8:12（日本時間）なら、あしたの0:00〜あさっての0:00', () => {
    // 2026-11-07 08:12 JST = 2026-11-06T23:12Z
    const w = nextJstDayWindow(new Date('2026-11-06T23:12:00Z'))
    expect(w.fromIso).toBe('2026-11-07T15:00:00.000Z') // 11/8 00:00 JST
    expect(w.toIso).toBe('2026-11-08T15:00:00.000Z') // 11/9 00:00 JST
  })

  it('日本時間の日付の境目：23:59 と 0:00 で窓が1日ずれる', () => {
    // 11/7 23:59 JST → あしたは 11/8
    expect(nextJstDayWindow(new Date('2026-11-07T14:59:00Z')).fromIso).toBe('2026-11-07T15:00:00.000Z')
    // 11/8 00:00 JST → あしたは 11/9
    expect(nextJstDayWindow(new Date('2026-11-07T15:00:00Z')).fromIso).toBe('2026-11-08T15:00:00.000Z')
  })

  it('窓はちょうど24時間で、月末・年末をまたいでも崩れない', () => {
    const w = nextJstDayWindow(new Date('2026-12-30T23:12:00Z')) // 12/31 08:12 JST
    expect(w.fromIso).toBe('2026-12-31T15:00:00.000Z') // 2027/1/1 00:00 JST
    expect(new Date(w.toIso).getTime() - new Date(w.fromIso).getTime()).toBe(24 * 3600_000)
  })
})

describe('formatJstShort / buildEventReminder', () => {
  it('UTC を日本時間の「11月8日 14:00」にする', () => {
    expect(formatJstShort('2026-11-08T05:00:00Z')).toBe('11月8日 14:00')
    expect(formatJstShort('2026-11-07T15:05:00Z')).toBe('11月8日 00:05')
  })

  it('壊れた日時は空文字', () => {
    expect(formatJstShort('not-a-date')).toBe('')
  })

  it('会場ありなら「日時〜 / 場所」', () => {
    const r = buildEventReminder({
      id: 'e1', title: '武蔵屋マルシェ', start_at: '2026-11-08T05:00:00Z', location: ' 武蔵屋 ', online_flag: false,
    })
    expect(r.title).toBe('明日のイベント「武蔵屋マルシェ」')
    expect(r.body).toBe('11月8日 14:00〜 / 武蔵屋')
    expect(r.linkUrl).toBe('/events/e1#remind-1d')
  })

  it('オンラインは場所の代わりに「オンライン」・場所なしなら日時だけ', () => {
    const online = buildEventReminder({ id: 'e2', title: 'オンライン会', start_at: '2026-11-08T05:00:00Z', location: '無視される', online_flag: true })
    expect(online.body).toBe('11月8日 14:00〜 / オンライン')
    const none = buildEventReminder({ id: 'e3', title: '場所未定', start_at: '2026-11-08T05:00:00Z', location: null, online_flag: false })
    expect(none.body).toBe('11月8日 14:00〜')
  })

  it('重複防止の目印の link は reminderLink と同じ', () => {
    expect(reminderLink('abc')).toBe('/events/abc#remind-1d')
  })
})

describe('pickReminderRecipients（送る相手の選別）', () => {
  const members = [
    { id: 'a', contact_preferences: {} },
    { id: 'b', contact_preferences: { notify_event: false } },
    { id: 'c', contact_preferences: { notify_event: true } },
    { id: 'd', contact_preferences: null },
    { id: 'e', contact_preferences: { notify_freefree: false } },
  ]

  it('イベント通知をOFFにした人・在籍していない人・受信済みの人・重複を除く', () => {
    const r = pickReminderRecipients({
      participantIds: ['a', 'b', 'c', 'c', 'gone', 'd', 'e'],
      members,
      alreadyNotified: new Set(['d']),
    })
    // b: OFF / gone: 在籍者に居ない / d: 受信済み / c: 重複は1回
    expect(r).toEqual(['a', 'c', 'e'])
  })

  it('FreeFree通知だけOFFの人にはイベントのリマインドを送る（種類ごとの設定を混ぜない）', () => {
    expect(pickReminderRecipients({ participantIds: ['e'], members, alreadyNotified: new Set() })).toEqual(['e'])
  })

  it('参加者が居なければ空', () => {
    expect(pickReminderRecipients({ participantIds: [], members, alreadyNotified: new Set() })).toEqual([])
  })
})
