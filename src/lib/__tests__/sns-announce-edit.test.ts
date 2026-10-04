// FreeFree 掲載を編集したときの SNS 再告知（reannounceFreefreeAfterEdit）の確認。
// 2026-10-04: 自動で投稿済みの掲載を編集すると、承認待ちの下書きが作り直され、承認すると同じ掲載が2回出ていた。
// 疑似DB（sns_post_logs だけ本物の動きをする）で、編集後に何が消え、何が作られるかを見る。

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Log = {
  id: string; target_type: string; target_id: string; medium: string
  status: string; approved_at: string | null; content?: string | null; error_message?: string | null
}

const db: { logs: Log[]; nextId: number } = { logs: [], nextId: 1 }
const POST = 'post-1'

// 「approved_at.is.null,approved_at.lt.<ISO>」だけを読める最小の or 条件
function orPredicate(expr: string): (r: Log) => boolean {
  const parts = expr.split(/,(?=approved_at\.)/)
  const preds = parts.map((p) => {
    if (p === 'approved_at.is.null') return (r: Log) => r.approved_at === null
    const m = p.match(/^approved_at\.lt\.(.+)$/)
    if (m) return (r: Log) => r.approved_at !== null && r.approved_at < m[1]
    throw new Error(`未対応の or 条件: ${p}`)
  })
  return (r) => preds.some((f) => f(r))
}

class Query {
  private conds: Array<(r: Log) => boolean> = []
  private mode: 'select' | 'delete' | 'insert' = 'select'
  private inserted: Log[] = []
  constructor(private table: string) {}
  select() { return this }
  delete() { this.mode = 'delete'; return this }
  insert(rows: Array<Partial<Log>>) {
    this.mode = 'insert'
    this.inserted = rows.map((r) => ({ id: `new-${db.nextId++}`, status: 'pending', approved_at: null, ...r }) as Log)
    db.logs.push(...this.inserted)
    return this
  }
  eq(col: keyof Log, v: unknown) { this.conds.push((r) => r[col] === v); return this }
  or(expr: string) { this.conds.push(orPredicate(expr)); return this }
  limit() { return this }
  async maybeSingle() {
    if (this.table === 'freefree_posts') return { data: { images: ['https://example.com/a.webp'], import_source: null }, error: null }
    if (this.table === 'app_settings') return { data: { value: { enabled: true } }, error: null }
    return { data: null, error: null }
  }
  then(resolve: (v: { data?: unknown; error: null | { message: string } }) => unknown) {
    if (this.table === 'members') throw new Error('members は使わない（通知はテストでは動かさない）')
    if (this.mode === 'delete') {
      db.logs = db.logs.filter((r) => !this.conds.every((c) => c(r)))
      return resolve({ error: null })
    }
    if (this.mode === 'insert') return resolve({ data: this.inserted, error: null })
    return resolve({ data: db.logs.filter((r) => this.conds.every((c) => c(r))), error: null })
  }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => new Query(t) }) }))
vi.mock('@/lib/sns-target', () => ({
  fetchSnsTarget: async () => ({ target_type: 'freefree', target_id: POST, title: '編集後のタイトル', body: null }),
}))
vi.mock('@/lib/sns-template', () => ({ generateSnsContent: (_t: unknown, medium: string) => `本文-${medium}` }))
vi.mock('@/lib/sns-dispatch', () => ({ dispatchLogs: async () => [] }))
vi.mock('@/lib/notify', () => ({ insertNotification: async () => {} }))
vi.mock('@/lib/mail', () => ({ normalizeMailFrom: (s: string) => s }))

import { reannounceFreefreeAfterEdit } from '../sns-announce'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
function log(medium: string, status: string, approvedAt: string | null): Log {
  return { id: `old-${medium}-${status}-${db.nextId++}`, target_type: 'freefree', target_id: POST, medium, status, approved_at: approvedAt }
}
const media = (rows: Log[]) => rows.map((r) => r.medium).sort()

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  db.logs = []
  db.nextId = 1
})

const edit = (snsShare = true) => reannounceFreefreeAfterEdit({ id: POST, title: '編集後のタイトル', snsShare })

describe('編集後の再告知', () => {
  it('3媒体とも配信済みなら、編集しても下書きを作らない（配信済みの記録も消さない）', async () => {
    db.logs = [log('threads', 'success', minutesAgo(5)), log('instagram', 'success', minutesAgo(5)), log('facebook', 'success', minutesAgo(5))]
    await edit()
    expect(db.logs).toHaveLength(3)
    expect(db.logs.every((r) => r.status === 'success')).toBe(true)
  })

  it('一部だけ配信済みなら、未配信の媒体にだけ承認待ちの下書きを作る', async () => {
    db.logs = [log('threads', 'success', minutesAgo(30)), log('instagram', 'pending', null), log('facebook', 'pending', null)]
    await edit()
    const drafts = db.logs.filter((r) => r.status === 'pending')
    expect(media(drafts)).toEqual(['facebook', 'instagram'])
    expect(drafts.every((r) => r.approved_at === null)).toBe(true) // 編集後は承認制
    expect(db.logs.filter((r) => r.status === 'success')).toHaveLength(1)
  })

  it('承認から10分以内の配信中の行は消さず、作り直しもしない', async () => {
    db.logs = [log('instagram', 'pending', minutesAgo(1))]
    const before = db.logs[0].id
    await edit()
    expect(db.logs).toHaveLength(1)
    expect(db.logs[0].id).toBe(before)
  })

  it('承認から時間がたった配信待ちの古い下書きは消して、新しい中身で作り直す', async () => {
    db.logs = [log('threads', 'pending', minutesAgo(120))]
    await edit()
    expect(db.logs).toHaveLength(3) // threads・facebook・instagram の3媒体
    expect(db.logs.some((r) => r.id.startsWith('old-'))).toBe(false)
    expect(db.logs.every((r) => r.approved_at === null)).toBe(true)
  })

  it('SNS紹介を許可していない掲載は、古い下書きを消すだけで作らない', async () => {
    db.logs = [log('threads', 'pending', null)]
    await edit(false)
    expect(db.logs).toHaveLength(0)
  })
})
