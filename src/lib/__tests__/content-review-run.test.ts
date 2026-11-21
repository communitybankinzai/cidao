import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyHold, failureReason, holdUpdate, isHeldState, isHoldable, restoreHold, restoreUpdate, reviewPost,
  type ReviewDeps, type ReviewRequest,
} from '@/lib/content-review-run'

// ---- 最小の偽の DB（呼ばれた操作を記録し、表と操作ごとに答えを返す）----
type Call = { table: string; op: 'select' | 'insert' | 'update' | 'delete'; payload?: unknown; filters: Array<[string, string, unknown]>; head?: boolean }
type Answer = { data?: unknown; error?: { message: string } | null; count?: number }

function fakeDb(answer: (c: Call) => Answer) {
  const calls: Call[] = []
  const from = (table: string) => {
    const c: Call = { table, op: 'select', filters: [] }
    const run = () => { calls.push(c); const a = answer(c); return { data: a.data ?? null, error: a.error ?? null, count: a.count } }
    const b: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) c.head = true; return b },
      insert: (p: unknown) => { c.op = 'insert'; c.payload = p; return b },
      update: (p: unknown) => { c.op = 'update'; c.payload = p; return b },
      delete: () => { c.op = 'delete'; return b },
      eq: (k: string, v: unknown) => { c.filters.push(['eq', k, v]); return b },
      neq: (k: string, v: unknown) => { c.filters.push(['neq', k, v]); return b },
      in: (k: string, v: unknown) => { c.filters.push(['in', k, v]); return b },
      gte: (k: string, v: unknown) => { c.filters.push(['gte', k, v]); return b },
      limit: () => b,
      maybeSingle: () => Promise.resolve(run()),
      single: () => Promise.resolve(run()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return { db: { from } as unknown as SupabaseClient, calls }
}

const req = (over: Partial<ReviewRequest> = {}): ReviewRequest => ({
  targetType: 'event', targetId: 'e1', action: 'create', authorId: 'u1', title: '題名', text: '題名\n本文', ...over,
})

type World = {
  admin?: boolean
  setting?: unknown
  used?: number
  state?: Record<string, unknown> | null
  openHold?: boolean
  updateRows?: number
}

function world(w: World = {}) {
  const f = fakeDb((c) => {
    if (c.table === 'members') return { data: { admin_role: w.admin ? 'staff' : null } }
    if (c.table === 'content_reviews' && c.op === 'select') return { data: w.openHold ? [{ id: 'r0' }] : [] }
    if (c.table === 'app_settings') return { data: w.setting === undefined ? null : { value: w.setting } }
    if (c.table === 'api_usage') return { count: w.used ?? 0 }
    if (c.table === 'content_reviews' && c.op === 'insert') return { data: { id: 'r1' } }
    if (c.table === 'content_reviews' && c.op === 'update') return { data: null }
    if (c.op === 'select') return { data: w.state === undefined ? { status: 'open' } : w.state }
    if (c.op === 'update') return { data: Array.from({ length: w.updateRows ?? 1 }, (_, i) => ({ id: `t${i}` })) }
    return {}
  })
  return f
}

function deps(db: SupabaseClient, classify?: ReviewDeps['classify']) {
  const d = {
    db,
    classify: vi.fn(classify ?? (async () => ({ result: { categories: [], confidence: 'low' as const, reason: '' }, usage: { input: 1, output: 1 } }))),
    recordUsage: vi.fn(async () => undefined),
    notifyAdmins: vi.fn(async () => undefined),
    notifyAuthor: vi.fn(async () => undefined),
  }
  return d
}

const heavyHigh = async () => ({ result: { categories: ['fraud' as const], confidence: 'high' as const, reason: '投資の勧誘' }, usage: { input: 10, output: 5 } })
const heavyLow = async () => ({ result: { categories: ['fraud' as const], confidence: 'low' as const, reason: 'たぶん' }, usage: { input: 10, output: 5 } })
const lightHigh = async () => ({ result: { categories: ['politics' as const], confidence: 'high' as const, reason: '候補者の支持' }, usage: { input: 10, output: 5 } })
const writes = (calls: Call[], table: string, op: Call['op']) => calls.filter((c) => c.table === table && c.op === op)

describe('止め方の分岐（入口ごと）', () => {
  it('止める更新：催し=draft・FreeFree=pending・団体=運営非公開・提案=draft', () => {
    expect(holdUpdate('event', 'T')).toEqual({ status: 'draft' })
    expect(holdUpdate('freefree', 'T')).toEqual({ status: 'pending' })
    expect(holdUpdate('proposal', 'T')).toEqual({ status: 'draft' })
    expect(holdUpdate('org', '2026-11-22T00:00:00.000Z')).toMatchObject({ public_flag: false, hidden_by_admin: true, hidden_at: '2026-11-22T00:00:00.000Z' })
    expect((holdUpdate('org', '2026-11-22T00:00:00.000Z') as { hidden_reason: string }).hidden_reason).not.toBe('')
  })
  it('止めてよいのは、いま公開されているものだけ', () => {
    expect(isHoldable('event', { status: 'open' })).toBe(true)
    expect(isHoldable('event', { status: 'draft' })).toBe(false)
    expect(isHoldable('freefree', { status: 'active' })).toBe(true)
    expect(isHoldable('freefree', { status: 'removed' })).toBe(false)
    expect(isHoldable('org', { public_flag: true })).toBe(true)
    expect(isHoldable('org', { public_flag: false, hidden_by_admin: true })).toBe(false)
    expect(isHoldable('proposal', { status: 'discussion' })).toBe(true)
    expect(isHoldable('proposal', { status: 'voting' })).toBe(false)
    expect(isHoldable('event', null)).toBe(false)
  })
  it('戻す前に「止めている状態か」を確かめる（運営がほかの画面で変えていたら戻さない）', () => {
    expect(isHeldState('freefree', { status: 'pending' })).toBe(true)
    expect(isHeldState('freefree', { status: 'removed' })).toBe(false)
    expect(isHeldState('org', { public_flag: false, hidden_by_admin: true })).toBe(true)
    expect(isHeldState('org', { public_flag: false, hidden_by_admin: false })).toBe(false) // 申告中の団体は戻さない
  })
  it('戻す更新：元の状態へ。提案は議論期間を数え直す', () => {
    expect(restoreUpdate('event', { status: 'closed' }, 'T')).toEqual({ status: 'closed' })
    expect(restoreUpdate('event', null, 'T')).toEqual({ status: 'open' })
    expect(restoreUpdate('freefree', null, 'T')).toEqual({ status: 'active' })
    expect(restoreUpdate('proposal', { status: 'discussion' }, 'T')).toEqual({ status: 'discussion', discussion_start_at: 'T' })
    expect(restoreUpdate('org', null, 'T')).toMatchObject({ public_flag: true, hidden_by_admin: false, hidden_reason: '', hidden_at: null })
  })
  it('applyHold：催しは draft 以外だけを更新する・複数日程はまとめて', async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ id: 'a' }, { id: 'b' }] }))
    expect(await applyHold(db, 'event', ['a', 'b'], 'T')).toBe(true)
    expect(calls[0].payload).toEqual({ status: 'draft' })
    expect(calls[0].filters).toContainEqual(['in', 'id', ['a', 'b']])
    expect(calls[0].filters).toContainEqual(['neq', 'status', 'draft'])
  })
  it('applyHold：1行も更新できなければ false', async () => {
    const { db } = fakeDb(() => ({ data: [] }))
    expect(await applyHold(db, 'freefree', ['a'], 'T')).toBe(false)
  })
  it('restoreHold：止めているものだけ戻す', async () => {
    const f = fakeDb((c) => (c.op === 'select' ? { data: { status: 'pending' } } : { data: [{ id: 'p1' }] }))
    expect(await restoreHold(f.db, 'freefree', 'p1', { status: 'active' }, 'T')).toEqual({ ok: true, changed: true })
    expect(writes(f.calls, 'freefree_posts', 'update')[0].payload).toEqual({ status: 'active' })
  })
  it('restoreHold：すでに状態が変わっていたら触らない（changed=false）', async () => {
    const f = fakeDb((c) => (c.op === 'select' ? { data: { status: 'removed' } } : { data: [{ id: 'p1' }] }))
    expect(await restoreHold(f.db, 'freefree', 'p1', null, 'T')).toEqual({ ok: true, changed: false })
    expect(writes(f.calls, 'freefree_posts', 'update')).toHaveLength(0)
  })
  it('restoreHold：複数日程の催しは全部戻す', async () => {
    const f = fakeDb((c) => (c.op === 'select' ? { data: { status: 'draft' } } : { data: [{ id: 'x' }] }))
    const r = await restoreHold(f.db, 'event', 'e1', { status: 'open', ids: ['e1', 'e2', 'e3'] }, 'T')
    expect(r).toEqual({ ok: true, changed: true })
    expect(writes(f.calls, 'events', 'update')).toHaveLength(3)
  })
})

describe('reviewPost（AI は差し替え）', () => {
  it('運営の投稿は類別しない', async () => {
    const w = world({ admin: true }); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'skipped' })
    expect(d.classify).not.toHaveBeenCalled()
  })
  it('スイッチが切れていたら何もしない', async () => {
    const w = world({ setting: { enabled: false } }); const d = deps(w.db, heavyHigh)
    expect((await reviewPost(req(), d)).verdict).toBe('skipped')
    expect(d.classify).not.toHaveBeenCalled()
  })
  it('1日の上限を超えたら、止めずに error として残す', async () => {
    const w = world({ setting: { enabled: true, daily_ai_limit: 5 }, used: 5 }); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'error' })
    expect(d.classify).not.toHaveBeenCalled()
    const row = writes(w.calls, 'content_reviews', 'insert')[0].payload as { verdict: string; held: boolean; reason: string }
    expect(row.verdict).toBe('error'); expect(row.held).toBe(false); expect(row.reason).toContain('上限')
    expect(writes(w.calls, 'events', 'update')).toHaveLength(0)
  })
  it('AI が失敗（時間切れなど）しても止めず、error として残す・通知は出さない', async () => {
    const w = world(); const d = deps(w.db, async () => { throw new Error('Request timed out.') })
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'error' })
    const row = writes(w.calls, 'content_reviews', 'insert')[0].payload as { verdict: string; reason: string }
    expect(row.verdict).toBe('error'); expect(row.reason).toContain('時間切れ')
    expect(d.notifyAdmins).not.toHaveBeenCalled()
    expect(writes(w.calls, 'events', 'update')).toHaveLength(0)
  })
  it('該当なしなら、行も通知も作らない（費用の記録だけ）', async () => {
    const w = world(); const d = deps(w.db)
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'ok' })
    expect(d.recordUsage).toHaveBeenCalledWith('u1', { input: 1, output: 1 })
    expect(writes(w.calls, 'content_reviews', 'insert')).toHaveLength(0)
    expect(d.notifyAdmins).not.toHaveBeenCalled()
  })
  it('確度の高い重い区分：行を先に作り、止める。止める前の状態を残し、運営と投稿者に知らせる', async () => {
    const w = world({ state: { status: 'open' } }); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req(), d)).toEqual({ held: true, verdict: 'hold' })
    const insertAt = w.calls.findIndex((c) => c.table === 'content_reviews' && c.op === 'insert')
    const holdAt = w.calls.findIndex((c) => c.table === 'events' && c.op === 'update')
    expect(insertAt).toBeGreaterThan(-1); expect(holdAt).toBeGreaterThan(insertAt) // 記録が先
    const row = w.calls[insertAt].payload as Record<string, unknown>
    expect(row).toMatchObject({ verdict: 'hold', held: true, categories: ['fraud'], confidence: 'high', target_type: 'event', author_id: 'u1', title_snapshot: '題名' })
    expect(row.prev_state).toEqual({ status: 'open' })
    expect(JSON.stringify(row)).not.toContain('本文') // 本文は保存しない
    expect(w.calls[holdAt].payload).toEqual({ status: 'draft' })
    expect(d.notifyAdmins).toHaveBeenCalledWith(w.db, expect.objectContaining({ held: true, categories: ['fraud'] }))
    expect(d.notifyAuthor).toHaveBeenCalledWith('u1', '/events/e1')
  })
  it('複数日程の催しは、全日程を止め、元の状態に ids を残す', async () => {
    const w = world({ state: { status: 'open' } }); const d = deps(w.db, heavyHigh)
    await reviewPost(req({ extraTargetIds: ['e2', 'e3'] }), d)
    const row = writes(w.calls, 'content_reviews', 'insert')[0].payload as { prev_state: unknown }
    expect(row.prev_state).toEqual({ status: 'open', ids: ['e1', 'e2', 'e3'] })
    expect(writes(w.calls, 'events', 'update')[0].filters).toContainEqual(['in', 'id', ['e1', 'e2', 'e3']])
  })
  it('確度が高くない重い区分は止めず、公開のまま運営に知らせる', async () => {
    const w = world(); const d = deps(w.db, heavyLow)
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'notify' })
    expect(writes(w.calls, 'events', 'update')).toHaveLength(0)
    expect(d.notifyAdmins).toHaveBeenCalledWith(w.db, expect.objectContaining({ held: false }))
    expect(d.notifyAuthor).not.toHaveBeenCalled()
  })
  it('軽い区分は確度が高くても止めない', async () => {
    const w = world(); const d = deps(w.db, lightHigh)
    expect(await reviewPost(req({ targetType: 'freefree', targetId: 'f1' }), d)).toEqual({ held: false, verdict: 'notify' })
    expect(writes(w.calls, 'freefree_posts', 'update')).toHaveLength(0)
  })
  it('コメントは重い区分でも止めない（notify・行に重い区分が残る）', async () => {
    const w = world(); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req({ targetType: 'proposal_comment', targetId: 'c1', parentId: 'q1', title: null, text: '本文' }), d))
      .toEqual({ held: false, verdict: 'notify' })
    expect(w.calls.some((c) => c.op === 'update')).toBe(false)
    const row = writes(w.calls, 'content_reviews', 'insert')[0].payload as { verdict: string; held: boolean; parent_id: string; categories: string[] }
    expect(row).toMatchObject({ verdict: 'notify', held: false, parent_id: 'q1', categories: ['fraud'] })
  })
  it('すでに公開されていない投稿（下書き）は止められないので、知らせるだけ', async () => {
    const w = world({ state: { status: 'draft' } }); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'notify' })
    expect(writes(w.calls, 'events', 'update')).toHaveLength(0)
  })
  it('止めようとして1行も更新できなかったら、記録を notify に直して公開のまま知らせる', async () => {
    const w = world({ updateRows: 0 }); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req(), d)).toEqual({ held: false, verdict: 'notify' })
    const fix = writes(w.calls, 'content_reviews', 'update')[0].payload as { verdict: string; held: boolean }
    expect(fix).toMatchObject({ verdict: 'notify', held: false })
    expect(d.notifyAuthor).not.toHaveBeenCalled()
  })
  it('編集で、すでに止めている投稿は読み直さない（止めたまま）', async () => {
    const w = world({ openHold: true }); const d = deps(w.db, heavyHigh)
    expect(await reviewPost(req({ action: 'update' }), d)).toEqual({ held: true, verdict: 'skipped' })
    expect(d.classify).not.toHaveBeenCalled()
  })
  it('例外が出ても投稿は止めない（例外を投げない）', async () => {
    const w = world(); const d = deps(w.db, heavyHigh)
    d.notifyAdmins.mockRejectedValueOnce(new Error('boom'))
    const out = await reviewPost(req(), d)
    expect(out.verdict).toBeDefined()
  })
})

describe('failureReason', () => {
  it('SDK のエラー文をそのまま出さない', () => {
    expect(failureReason(new Error('Request timed out'))).toContain('時間切れ')
    expect(failureReason(new Error('ANTHROPIC_API_KEY not configured'))).toContain('設定')
    expect(failureReason(new Error('sk-secret 500'))).not.toContain('sk-secret')
  })
})
