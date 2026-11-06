import { describe, expect, it } from 'vitest'
import { REACH_BASELINE, summarizeReach } from '@/lib/admin-reach'

const NOW = new Date('2026-11-13T00:00:00Z')

describe('summarizeReach（届いているか）', () => {
  const members = [
    { id: 'm1', tier: 'verified', contact_preferences: {} },
    { id: 'm2', tier: 'light', contact_preferences: { notify_event: false, notify_freefree: false } },
    { id: 'm3', tier: 'verified', contact_preferences: { notify_event: false } },
    { id: 'm4', tier: 'light', contact_preferences: null },
  ]

  it('購読・14日ログイン・既読ゼロ・仮登録・OFF を人数で数える', () => {
    const r = summarizeReach({
      members,
      pushMemberIds: ['m1', 'm1', 'm3'], // m1 は2端末でも1人
      notifiedIds: ['m1', 'm2', 'm3', 'm4'],
      readIds: ['m1'],
      lastSignIns: new Map([
        ['m1', '2026-11-12T00:00:00Z'], // 1日前
        ['m2', '2026-10-20T00:00:00Z'], // 24日前
        ['m3', '2026-10-30T00:00:00Z'], // ちょうど14日前（含む）
        ['m4', null],
      ]),
      now: NOW,
    })
    expect(r).toEqual({
      total: 4,
      push: 2,
      loggedIn14d: 2,
      neverRead: 3, // m2, m3, m4（通知は届いているが既読なし）
      light: 2,
      offEvent: 2,
      offFreeFree: 1,
    })
  })

  it('通知がまだ届いていない人は「既読ゼロ」に数えない', () => {
    const r = summarizeReach({
      members,
      pushMemberIds: [],
      notifiedIds: ['m1'],
      readIds: [],
      lastSignIns: new Map(),
      now: NOW,
    })
    expect(r.neverRead).toBe(1)
  })

  it('退会した人（members に居ない）の購読・既読は数えない', () => {
    const r = summarizeReach({
      members,
      pushMemberIds: ['gone1', 'gone2', 'm1'],
      notifiedIds: ['gone1', 'm1'],
      readIds: ['gone1'],
      lastSignIns: new Map([['gone1', '2026-11-12T00:00:00Z']]),
      now: NOW,
    })
    expect(r.push).toBe(1)
    expect(r.neverRead).toBe(1) // m1 のみ（gone1 は在籍外）
    expect(r.loggedIn14d).toBe(0)
  })

  it('基準値は 2026-11-06 の実測（在籍44名）', () => {
    expect(REACH_BASELINE).toMatchObject({ date: '2026-11-06', total: 44, push: 5, loggedIn14d: 17, neverRead: 19 })
  })
})
