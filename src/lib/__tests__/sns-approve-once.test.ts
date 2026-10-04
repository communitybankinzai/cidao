// 承認は最初の1回だけ有効で、2回目以降は配信しないことの確認（2026-10-04 Instagram 二重投稿の再発防止）。
// 疑似DB（1行だけ持つ）で、同じ承認を並べて呼ぶ。

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string; status: string; approved_at: string | null; content: string | null; medium: string; target_type: string; target_id: string }

const state: { row: Row | null } = { row: null }
const dispatchLogs = vi.fn(async (_s: unknown, logs: Array<{ id: string }>) =>
  logs.map((l) => ({ id: l.id, medium: 'instagram', outcome: 'success' })),
)

// update(...).eq(...).is(...).select(...).maybeSingle() を、条件つきで1行だけ書き換える疑似クエリ
function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    rpc: async () => ({ data: true }),
    from: () => ({
      update: (patch: Partial<Row>) => {
        const conds: Array<(r: Row) => boolean> = []
        const q = {
          eq: (col: keyof Row, v: unknown) => { conds.push((r) => r[col] === v); return q },
          is: (col: keyof Row, v: unknown) => { conds.push((r) => r[col] === v); return q },
          select: () => ({
            maybeSingle: async () => {
              const r = state.row
              if (!r || !conds.every((c) => c(r))) return { data: null, error: null }
              Object.assign(r, patch)
              return { data: { ...r }, error: null }
            },
          }),
        }
        return q
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.row ? { status: state.row.status, approved_at: state.row.approved_at } : null, error: null }) }),
      }),
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabase() }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/sns-dispatch', () => ({ dispatchLogs: (s: unknown, l: Array<{ id: string }>) => dispatchLogs(s, l) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

import { approveDraft, approveAndDispatchDraft } from '../../app/admin/sns/actions'

beforeEach(() => {
  dispatchLogs.mockClear()
  state.row = { id: 'log-1', status: 'pending', approved_at: null, content: null, medium: 'instagram', target_type: 'freefree', target_id: 'p-1' }
})

describe('承認は最初の1回だけ有効', () => {
  it('approveDraft を同時に3回呼んでも配信は1回だけ', async () => {
    const results = await Promise.all([approveDraft('log-1', '本文'), approveDraft('log-1', '本文'), approveDraft('log-1', '本文')])
    expect(dispatchLogs).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const rejected = results.filter((r) => !r.ok) as Array<{ ok: false; error: string }>
    expect(rejected).toHaveLength(2)
    expect(rejected[0].error).toContain('すでに処理済み')
  })

  it('approveAndDispatchDraft も同時に呼んで配信は1回だけ', async () => {
    const results = await Promise.all([approveAndDispatchDraft('log-1', '本文'), approveAndDispatchDraft('log-1', '本文')])
    expect(dispatchLogs).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('対象が無いときは「処理済み」ではなく見つからないと返す', async () => {
    state.row = null
    const r = await approveDraft('nope', '本文')
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toContain('見つかりません')
    expect(dispatchLogs).not.toHaveBeenCalled()
  })
})
