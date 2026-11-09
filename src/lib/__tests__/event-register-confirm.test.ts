import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertNotification } = vi.hoisted(() => ({ insertNotification: vi.fn() }))
vi.mock('@/lib/notify', () => ({ insertNotification }))

import { buildRegisterConfirm, sendRegisterConfirm } from '@/lib/event-register-confirm'

describe('buildRegisterConfirm', () => {
  it('宛先人数と、届いた端末数を書く', () => {
    expect(buildRegisterConfirm({ title: '武蔵屋マルシェ', recipients: 35, pushed: 4 })).toEqual({
      title: '「武蔵屋マルシェ」を登録しました',
      body: '35人にお知らせしました。スマホに通知が届いた端末は 4台',
    })
  })

  it('スマホへの通知が0台なら、ベルだけだったと書く', () => {
    const n = buildRegisterConfirm({ title: 'x', recipients: 12, pushed: 0 })
    expect(n.body).toBe('12人にお知らせしました。スマホへの通知は0台（アプリ内のベル🔔のみ）')
  })

  it('宛先が0人なら、失敗の可能性と、登録は完了していることを書く', () => {
    const n = buildRegisterConfirm({ title: 'x', recipients: 0, pushed: 0 })
    expect(n.body).toContain('0人')
    expect(n.body).toContain('送信に失敗した可能性')
    expect(n.body).toContain('登録そのものは完了')
  })

  it('複数日程をまとめて登録したときは、全N回と書く（1回だけなら書かない）', () => {
    expect(buildRegisterConfirm({ title: 'x', recipients: 3, pushed: 0, occurrences: 4 }).title).toBe('「x」（全4回）を登録しました')
    expect(buildRegisterConfirm({ title: 'x', recipients: 3, pushed: 0, occurrences: 1 }).title).toBe('「x」を登録しました')
  })

  it('長い題名は40字で切る（通知の見出しが画面からあふれないように）', () => {
    const long = 'あ'.repeat(60)
    expect(buildRegisterConfirm({ title: long, recipients: 1, pushed: 0 }).title).toBe(`「${'あ'.repeat(40)}…」を登録しました`)
  })

  it('会員の名前を載せない（人数だけ）', () => {
    const text = JSON.stringify(buildRegisterConfirm({ title: 'x', recipients: 5, pushed: 1 }))
    expect(text).not.toContain('display_name')
  })
})

describe('sendRegisterConfirm', () => {
  beforeEach(() => {
    insertNotification.mockReset()
    insertNotification.mockResolvedValue({ inserted: true, pushed: 1 })
  })

  it('登録した本人に1通だけ送る。actorId は渡さない（渡すと自分宛てで除かれる）', async () => {
    const ok = await sendRegisterConfirm({
      memberId: 'me',
      eventId: 'ev1',
      title: '武蔵屋マルシェ',
      result: { recipients: 35, pushed: 4 },
    })
    expect(ok).toBe(true)
    expect(insertNotification).toHaveBeenCalledTimes(1)
    const arg = insertNotification.mock.calls[0][0]
    expect(arg).toMatchObject({
      recipientId: 'me',
      kind: 'event',
      title: '「武蔵屋マルシェ」を登録しました',
      body: '35人にお知らせしました。スマホに通知が届いた端末は 4台',
      linkUrl: '/events/ev1',
    })
    expect('actorId' in arg).toBe(false)
  })

  it('宛先0人でも、本人には「0人でした」を返す（黙らない）', async () => {
    await sendRegisterConfirm({ memberId: 'me', eventId: 'ev1', title: 'x', result: { recipients: 0, pushed: 0 } })
    expect(insertNotification.mock.calls[0][0].body).toContain('0人')
  })

  it('保存できなかったときは false、例外は外へ出さない', async () => {
    insertNotification.mockResolvedValueOnce({ inserted: false, pushed: 0 })
    expect(await sendRegisterConfirm({ memberId: 'me', eventId: 'e', title: 'x', result: { recipients: 1, pushed: 0 } })).toBe(false)
    insertNotification.mockRejectedValueOnce(new Error('boom'))
    expect(await sendRegisterConfirm({ memberId: 'me', eventId: 'e', title: 'x', result: { recipients: 1, pushed: 0 } })).toBe(false)
  })
})
