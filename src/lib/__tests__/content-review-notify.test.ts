import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { insertNotification, send } = vi.hoisted(() => ({
  insertNotification: vi.fn(async () => ({ inserted: true, pushed: 0 })),
  send: vi.fn(async () => ({ error: null })),
}))
vi.mock('@/lib/notify', () => ({ insertNotification }))
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))

import { notifyAdminsOfOpenReviews, notifyAdminsOfReview, notifyAuthorOfHold } from '@/lib/content-review-notify'

type Answer = { data?: unknown; error?: { message: string } | null }

/** 表ごとの答えを返す偽の DB */
function fakeDb(tables: Record<string, Answer>) {
  const from = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'like', 'gte', 'limit']) b[m] = () => b
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null }).then(res, rej)
    return b
  }
  return { from } as unknown as SupabaseClient
}

const admins = { data: [{ id: 'a1' }, { id: 'a2' }] }
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

beforeEach(() => {
  process.env.RESEND_API_KEY = 'k'
  process.env.MAIL_FROM = 'CiDAO <noreply@example.com>'
  process.env.ADMIN_NOTIFY_EMAIL = 'ops@example.com'
})
afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.MAIL_FROM
  delete process.env.ADMIN_NOTIFY_EMAIL
})

describe('notifyAdminsOfReview（notify・hold が出たとき）', () => {
  it('運営全員にベル（kind system・リンク /admin/review）と、メール1通', async () => {
    await notifyAdminsOfReview(fakeDb({ members: admins }), { targetType: 'freefree', title: '副業', categories: ['fraud'], reason: '勧誘', held: true })
    expect(insertNotification).toHaveBeenCalledTimes(2)
    expect(insertNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'a1', kind: 'system', linkUrl: '/admin/review',
      title: '投稿の審査：詐欺・勧誘商法の疑い（公開を止めました）',
    }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.com', subject: '【CiDAO】投稿の公開を止めました（審査をお願いします）',
    }))
  })
  it('公開中のときの件名', async () => {
    await notifyAdminsOfReview(fakeDb({ members: admins }), { targetType: 'event', title: 't', categories: ['politics'], reason: '', held: false })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: '【CiDAO】投稿の確認をお願いします（公開中）' }))
  })
  it('メールの送信に失敗しても例外を出さない・ベルは出ている', async () => {
    send.mockRejectedValueOnce(new Error('resend down'))
    await expect(notifyAdminsOfReview(fakeDb({ members: admins }), { targetType: 'event', title: 't', categories: ['politics'], reason: '', held: false })).resolves.toBeUndefined()
    expect(insertNotification).toHaveBeenCalledTimes(2)
  })
  it('メールの設定が無ければメールは送らない（ベルは出す）', async () => {
    delete process.env.ADMIN_NOTIFY_EMAIL
    await notifyAdminsOfReview(fakeDb({ members: admins }), { targetType: 'event', title: 't', categories: ['politics'], reason: '', held: false })
    expect(send).not.toHaveBeenCalled()
    expect(insertNotification).toHaveBeenCalledTimes(2)
  })
})

describe('notifyAuthorOfHold', () => {
  it('投稿者へ「確認中です」（理由の区分は書かない）', async () => {
    await notifyAuthorOfHold('u1', '/events/e1')
    expect(insertNotification).toHaveBeenCalledWith({
      recipientId: 'u1', kind: 'system', title: '投稿の確認中です',
      body: '運営が内容を確かめています。問題がなければ公開されます', linkUrl: '/events/e1',
    })
  })
})

describe('notifyAdminsOfOpenReviews（毎朝のまとめ）', () => {
  const rows = { data: [
    { verdict: 'hold', held: true, created_at: ago(30) },
    { verdict: 'hold', held: true, created_at: ago(1) },
    { verdict: 'notify', held: false, created_at: ago(5) },
  ] }
  it('0件なら何も出さない', async () => {
    const r = await notifyAdminsOfOpenReviews(fakeDb({ content_reviews: { data: [] }, members: admins }))
    expect(r.notified).toBe(false)
    expect(insertNotification).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it('残っていれば、運営全員へベル＋プッシュと、メール1通（24時間以上の数を含む）', async () => {
    const r = await notifyAdminsOfOpenReviews(fakeDb({ content_reviews: rows, notifications: { data: [] }, members: admins }))
    expect(r).toMatchObject({ notified: true, total: 3, held: 2, staleHeld: 1 })
    expect(insertNotification).toHaveBeenCalledTimes(2)
    expect(insertNotification).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'system', linkUrl: '/admin/review',
      title: '投稿の審査待ちが 3 件あります（うち公開を止めているもの 2 件）',
      body: expect.stringContaining('24時間以上止まっている投稿が 1 件あります（投稿者が待っています）'),
    }))
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('直近に通知済みなら、重ねて出さない', async () => {
    const r = await notifyAdminsOfOpenReviews(fakeDb({ content_reviews: rows, notifications: { data: [{ id: 'n1' }] }, members: admins }))
    expect(r.notified).toBe(false)
    expect(insertNotification).not.toHaveBeenCalled()
  })
  it('審査待ちを読めなかったときは例外を出さず、何も出さない', async () => {
    const r = await notifyAdminsOfOpenReviews(fakeDb({ content_reviews: { error: { message: 'x' } } }))
    expect(r.notified).toBe(false)
    expect(insertNotification).not.toHaveBeenCalled()
  })
  it('通知で例外が出ても、呼び出し元（cron の本体）は止まらない', async () => {
    insertNotification.mockRejectedValueOnce(new Error('boom'))
    await expect(notifyAdminsOfOpenReviews(fakeDb({ content_reviews: rows, notifications: { data: [] }, members: admins }))).resolves.toMatchObject({ notified: false })
  })
})
