import { describe, expect, it } from 'vitest'
import { attendanceCopy, capacityLine, isEventFull } from '@/lib/event-attendance-copy'

const proxy = { proxy_registration: true }
const native = { proxy_registration: false }

describe('attendanceCopy', () => {
  it('外部イベントは「行く予定」。ボタンも欄の見出しもそろう', () => {
    const c = attendanceCopy(proxy)
    expect(c.heading).toBe('行く予定')
    expect(c.joinButton).toBe('行く予定にする')
    expect(c.loginButton).toBe('ログインして行く予定にする')
    expect(c.cancelButton).toBe('予定をやめる')
  })

  it('外部イベントの補足は「主催者への申し込みではない」ことと前日の朝のお知らせを書く', () => {
    const hint = attendanceCopy(proxy).joinHint ?? ''
    expect(hint).toContain('前日の朝')
    expect(hint).toContain('主催者への申し込みではありません')
    expect(hint).toContain('直前に追加した場合は届かないことがあります')
  })

  it('CiDAO内のイベントは従来どおり（参加する／キャンセル／補足なし）', () => {
    const c = attendanceCopy(native)
    expect(c.heading).toBe('参加')
    expect(c.joinButton).toBe('参加する')
    expect(c.loginButton).toBe('ログインして参加')
    expect(c.cancelButton).toBe('キャンセル')
    expect(c.joinHint).toBeNull()
    expect(c.statusLine('participant')).toBe('あなたは 参加者 として登録中')
    expect(c.countLine({ organizer: 1, staff: 2, participant: 3 })).toBe('主催 1 / スタッフ 2 / 参加 3')
  })

  it('外部イベントで参加者の行を持つ人は「行く予定に入れています」。主催者・スタッフは役割をそのまま出す', () => {
    const c = attendanceCopy(proxy)
    expect(c.statusLine('participant')).toBe('あなたは「行く予定」に入れています')
    expect(c.statusLine('organizer')).toBe('あなたは 主催者 として登録中')
    expect(c.statusLine('staff')).toBe('あなたは スタッフ として登録中')
  })

  it('外部イベントの人数は1人以上のときだけ出す（0人の「行く予定 0人」は出さない）', () => {
    const c = attendanceCopy(proxy)
    expect(c.countLine({ organizer: 0, staff: 0, participant: 0 })).toBeNull()
    expect(c.countLine({ organizer: 0, staff: 0, participant: 2 })).toBe('行く予定 2人')
  })

  it('ログイン前の案内は、外部イベントでは「申し込み」ではなく「前日の朝のお知らせ」を前に出す', () => {
    const all = (c: ReturnType<typeof attendanceCopy>) => c.loginLead.before + c.loginLead.strong + c.loginLead.after
    expect(all(attendanceCopy(proxy))).toContain('前日の朝')
    expect(all(attendanceCopy(proxy))).not.toContain('参加の申し込み')
    expect(all(attendanceCopy(native))).toContain('参加の申し込み')
  })

  it('「LINEでワンタップ、登録も利用も無料」は、どちらの案内でも太字の部分として残る', () => {
    expect(attendanceCopy(proxy).loginLead.strong).toBe('LINEでワンタップ、登録も利用も無料')
    expect(attendanceCopy(native).loginLead.strong).toBe('LINEでワンタップ、登録も利用も無料')
  })
})

describe('isEventFull / capacityLine', () => {
  it('外部イベントは定員に達しても締め切らない（席の予約ではないため）', () => {
    expect(isEventFull({ proxy_registration: true, capacity: 5 }, 9)).toBe(false)
  })

  it('CiDAO内のイベントは、定員に達したら締め切る。定員なしなら締め切らない', () => {
    expect(isEventFull({ proxy_registration: false, capacity: 5 }, 4)).toBe(false)
    expect(isEventFull({ proxy_registration: false, capacity: 5 }, 5)).toBe(true)
    expect(isEventFull({ proxy_registration: false, capacity: null }, 99)).toBe(false)
  })

  it('定員の一行：外部イベントは「現在N名」を付けない', () => {
    expect(capacityLine({ proxy_registration: true, capacity: 30 }, 2)).toBe('定員: 30 名')
    expect(capacityLine({ proxy_registration: false, capacity: 30 }, 2)).toBe('定員: 30 名（現在 2 名）')
    expect(capacityLine({ proxy_registration: false, capacity: null }, 2)).toBeNull()
  })
})
