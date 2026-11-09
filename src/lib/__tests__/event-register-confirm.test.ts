import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertNotification, holder } = vi.hoisted(() => ({
  insertNotification: vi.fn(),
  holder: { prefs: undefined as unknown, throwOnRead: false },
}))
vi.mock('@/lib/notify', () => ({ insertNotification }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = () => {
        if (holder.throwOnRead) throw new Error('read failed')
        return Promise.resolve({ data: { contact_preferences: holder.prefs }, error: null })
      }
      return b
    },
  }),
}))

import { buildRegisterConfirm, sendRegisterConfirm } from '@/lib/event-register-confirm'
import { REGISTER_CONFIRM_PUSH_KEY, wantsRegisterConfirmPush } from '@/lib/register-confirm-pref'

describe('wantsRegisterConfirmPush（スマホにも鳴らすか）', () => {
  it('未設定・空・null は、従来どおり鳴らす', () => {
    expect(wantsRegisterConfirmPush(undefined)).toBe(true)
    expect(wantsRegisterConfirmPush(null)).toBe(true)
    expect(wantsRegisterConfirmPush({})).toBe(true)
    expect(wantsRegisterConfirmPush({ notify_event: false })).toBe(true) // 他の設定には引きずられない
  })

  it('true は鳴らす、false を選んだ人だけベルのみ', () => {
    expect(wantsRegisterConfirmPush({ [REGISTER_CONFIRM_PUSH_KEY]: true })).toBe(true)
    expect(wantsRegisterConfirmPush({ [REGISTER_CONFIRM_PUSH_KEY]: false })).toBe(false)
  })

  it('保存キーは register_confirm_push（マイページの保存処理と同じ定義を使う）', () => {
    expect(REGISTER_CONFIRM_PUSH_KEY).toBe('register_confirm_push')
  })
})

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
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-example'
    holder.prefs = undefined
    holder.throwOnRead = false
    insertNotification.mockReset()
    insertNotification.mockResolvedValue({ inserted: true, pushed: 1 })
  })

  const send = () =>
    sendRegisterConfirm({ memberId: 'me', eventId: 'ev1', title: 'x', result: { recipients: 3, pushed: 1 } })

  it('設定が無い人には、スマホにも鳴らす（push: true）', async () => {
    holder.prefs = {}
    await send()
    expect(insertNotification.mock.calls[0][0].push).toBe(true)
  })

  it('「ベルだけ」を選んだ人には、スマホは鳴らさない（push: false）。確認通知そのものは出す', async () => {
    holder.prefs = { [REGISTER_CONFIRM_PUSH_KEY]: false }
    expect(await send()).toBe(true)
    expect(insertNotification).toHaveBeenCalledTimes(1)
    expect(insertNotification.mock.calls[0][0].push).toBe(false)
  })

  it('設定が読めないとき（通信の失敗・サーバー設定なし）は、確認が届かなくなる事故を避けて従来どおり鳴らす', async () => {
    holder.throwOnRead = true
    await send()
    expect(insertNotification.mock.calls[0][0].push).toBe(true)
    insertNotification.mockClear()
    holder.throwOnRead = false
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await send()
    expect(insertNotification.mock.calls[0][0].push).toBe(true)
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
