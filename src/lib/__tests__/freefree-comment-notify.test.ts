// FreeFree の応援メッセージを掲載者へ通知する処理（notifyFreefreeComment）の確認。
// 疑似DBに掲載・団体・メンバーを置き、誰に・何が届くかを見る。

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const notify = vi.fn(async (_input: Record<string, unknown>) => {})

class Query {
  private conds: Array<(r: Row) => boolean> = []
  constructor(private table: string) {}
  select() { return this }
  eq(col: string, v: unknown) { this.conds.push((r) => r[col] === v); return this }
  is(col: string, v: unknown) { this.conds.push((r) => (r[col] ?? null) === v); return this }
  in(col: string, vs: unknown[]) { this.conds.push((r) => vs.includes(r[col])); return this }
  private rows() { return (tables[this.table] ?? []).filter((r) => this.conds.every((c) => c(r))) }
  async maybeSingle() { return { data: this.rows()[0] ?? null, error: null } }
  then(resolve: (v: { data: Row[]; error: null }) => unknown) { return resolve({ data: this.rows(), error: null }) }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => new Query(t) }) }))
vi.mock('@/lib/notify', () => ({ insertNotification: (i: Record<string, unknown>) => notify(i) }))

import { notifyFreefreeComment, commentPreview } from '../freefree-comment-notify'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  notify.mockClear()
  for (const k of Object.keys(tables)) delete tables[k]
  tables.members = [
    { id: 'owner', display_name: 'カケル', deleted_at: null },
    { id: 'fan', display_name: 'ゆうさん', deleted_at: null },
    { id: 'rep', display_name: '代表', deleted_at: null },
    { id: 'm1', display_name: 'メンバー1', deleted_at: null },
    { id: 'm-left', display_name: '脱退者', deleted_at: null },
    { id: 'm-pending', display_name: '未確認', deleted_at: null },
    { id: 'm-deleted', display_name: '退会済み', deleted_at: '2026-09-01' },
    { id: 'noname', display_name: '  ', deleted_at: null },
  ]
})

describe('応援メッセージの通知', () => {
  it('個人の掲載では、掲載者本人にベル通知（種類・リンク・本文つき）を1件送る', async () => {
    tables.freefree_posts = [{ id: 'p1', poster_type: 'individual_business', poster_id: 'owner', title: '3歳からのバレエ教室' }]
    await notifyFreefreeComment({ postId: 'p1', commenterId: 'fan', body: '応援しています！' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      recipientId: 'owner',
      actorId: 'fan',
      kind: 'comment',
      title: 'FreeFree「3歳からのバレエ教室」に応援メッセージが届きました',
      body: 'ゆうさん：応援しています！',
      linkUrl: '/freefree/p1',
    })
  })

  it('自分の掲載への自分のコメントは通知しない', async () => {
    tables.freefree_posts = [{ id: 'p1', poster_type: 'member', poster_id: 'owner', title: 't' }]
    await notifyFreefreeComment({ postId: 'p1', commenterId: 'owner', body: 'ありがとう' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('団体の掲載では、代表者と確認済みメンバーに送る（脱退・未確認・退会済み・重複は除く）', async () => {
    tables.freefree_posts = [{ id: 'p2', poster_type: 'org', poster_id: 'org-1', title: '団体の掲載' }]
    tables.organizations = [{ id: 'org-1', representative_id: 'rep' }]
    tables.memberships = [
      { org_id: 'org-1', member_id: 'rep', status: 'confirmed', left_at: null }, // 代表者と重複
      { org_id: 'org-1', member_id: 'm1', status: 'confirmed', left_at: null },
      { org_id: 'org-1', member_id: 'm-left', status: 'confirmed', left_at: '2026-09-10' },
      { org_id: 'org-1', member_id: 'm-pending', status: 'pending', left_at: null },
      { org_id: 'org-1', member_id: 'm-deleted', status: 'confirmed', left_at: null },
      { org_id: 'org-2', member_id: 'owner', status: 'confirmed', left_at: null }, // 別の団体
    ]
    await notifyFreefreeComment({ postId: 'p2', commenterId: 'fan', body: 'がんばって' })
    const to = notify.mock.calls.map((c) => c[0].recipientId).sort()
    expect(to).toEqual(['m1', 'rep'])
  })

  it('団体のメンバー自身がコメントしたら、その人には送らない', async () => {
    tables.freefree_posts = [{ id: 'p2', poster_type: 'org', poster_id: 'org-1', title: 't' }]
    tables.organizations = [{ id: 'org-1', representative_id: 'rep' }]
    tables.memberships = [{ org_id: 'org-1', member_id: 'm1', status: 'confirmed', left_at: null }]
    await notifyFreefreeComment({ postId: 'p2', commenterId: 'm1', body: 'x' })
    expect(notify.mock.calls.map((c) => c[0].recipientId)).toEqual(['rep'])
  })

  it('掲載が見つからなくても例外にせず、何も送らない', async () => {
    tables.freefree_posts = []
    await expect(notifyFreefreeComment({ postId: 'none', commenterId: 'fan', body: 'x' })).resolves.toBeUndefined()
    expect(notify).not.toHaveBeenCalled()
  })

  it('表示名が空なら「会員の方」と表示する', async () => {
    tables.freefree_posts = [{ id: 'p1', poster_type: 'member', poster_id: 'owner', title: 't' }]
    await notifyFreefreeComment({ postId: 'p1', commenterId: 'noname', body: 'こんにちは' })
    expect(notify.mock.calls[0][0].body).toBe('会員の方：こんにちは')
  })
})

describe('commentPreview', () => {
  it('改行を空白にし、60字を超えたら「…」で切る', () => {
    expect(commentPreview('一行目\n\n二行目')).toBe('一行目 二行目')
    const long = 'あ'.repeat(70)
    expect(commentPreview(long)).toBe(`${'あ'.repeat(60)}…`)
    expect(commentPreview('あ'.repeat(60))).toBe('あ'.repeat(60))
  })
})
