// FreeFree 掲載を編集したときの SNS 再告知（reannounceFreefreeAfterEdit）の確認。
// 2026-10-04: 自動で投稿済みの掲載を編集すると、承認待ちの下書きが作り直され、承認すると同じ掲載が2回出ていた。
// 疑似DB（sns_post_logs だけ本物の動きをする）で、編集後に何が消え、何が作られるかを見る。

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Log = {
  id: string; target_type: string; target_id: string; medium: string
  status: string; approved_at: string | null; content?: string | null; error_message?: string | null
  posted_id?: string | null; posted_at?: string | null; created_at?: string
}

const db: {
  logs: Log[]; nextId: number
  takedowns: Array<Record<string, unknown>>
  autoEnabled: boolean
  failMedia: string[] // 配信に失敗させる媒体
  dispatched: string[] // 配信に回された行のID
} = { logs: [], nextId: 1, takedowns: [], autoEnabled: true, failMedia: [], dispatched: [] }
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
  upsert(rows: Array<Record<string, unknown>>) {
    db.takedowns.push(...rows)
    return this
  }
  eq(col: keyof Log, v: unknown) { this.conds.push((r) => r[col] === v); return this }
  or(expr: string) { this.conds.push(orPredicate(expr)); return this }
  limit() { return this }
  async maybeSingle() {
    if (this.table === 'freefree_posts') return { data: { images: ['https://example.com/a.webp'], import_source: null }, error: null }
    if (this.table === 'app_settings') return { data: { value: { enabled: db.autoEnabled } }, error: null }
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
vi.mock('@/lib/sns-dispatch', () => ({
  // 配信に回された行は、failMedia 以外なら成功、そのログも success にする（本物の markLog と同じ）
  dispatchLogs: async (_s: unknown, rows: Array<{ id: string; medium: string }>) =>
    rows.map((r) => {
      db.dispatched.push(r.id)
      const ok = !db.failMedia.includes(r.medium)
      const row = db.logs.find((l) => l.id === r.id)
      if (row && ok) row.status = 'success'
      return { id: r.id, medium: r.medium, outcome: ok ? 'success' : 'failed' }
    }),
}))
vi.mock('@/lib/sns-takedown', () => ({ notifyPendingSnsTakedowns: async () => 0 }))
vi.mock('@/lib/notify', () => ({ insertNotification: async () => {} }))
vi.mock('@/lib/mail', () => ({ normalizeMailFrom: (s: string) => s }))

import { reannounceFreefreeAfterEdit } from '../sns-announce'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
function log(medium: string, status: string, approvedAt: string | null, extra: Partial<Log> = {}): Log {
  return { id: `old-${medium}-${status}-${db.nextId++}`, target_type: 'freefree', target_id: POST, medium, status, approved_at: approvedAt, ...extra }
}
// 配信済み（success）。content は「前回配信した本文」。posted_at は何時間前に出したか
function delivered(medium: string, content: string, postedHoursAgo = 48): Log {
  return log(medium, 'success', hoursAgo(postedHoursAgo), { content, posted_id: `pid-${medium}`, posted_at: hoursAgo(postedHoursAgo), created_at: hoursAgo(postedHoursAgo) })
}
const media = (rows: Log[]) => rows.map((r) => r.medium).sort()

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  db.logs = []
  db.nextId = 1
  db.takedowns = []
  db.autoEnabled = true
  db.failMedia = []
  db.dispatched = []
})

const edit = (snsShare = true) => reannounceFreefreeAfterEdit({ id: POST, title: '編集後のタイトル', snsShare })

describe('編集後の再告知', () => {
  it('3媒体とも配信済みで、紹介文が前回と同じなら、何も作らない（配信済みの記録も消さない）', async () => {
    db.logs = [delivered('threads', '本文-threads'), delivered('instagram', '本文-instagram'), delivered('facebook', '本文-facebook')]
    await edit()
    expect(db.logs).toHaveLength(3)
    expect(db.logs.every((r) => r.status === 'success')).toBe(true)
    expect(db.dispatched).toHaveLength(0)
    expect(db.takedowns).toHaveLength(0)
  })

  it('一部だけ配信済みなら、未配信の媒体にだけ承認待ちの下書きを作る', async () => {
    db.logs = [delivered('threads', '本文-threads'), log('instagram', 'pending', null), log('facebook', 'pending', null)]
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

describe('編集後の自動の出し直し（紹介文が変わったときだけ）', () => {
  const OLD = (m: string) => `前の版-${m}`

  it('紹介文が変わっていて24時間以上たっていれば、承認済みで自動配信し、古い版を削除待ち（superseded）に載せる', async () => {
    db.logs = [delivered('threads', OLD('threads')), delivered('instagram', OLD('instagram')), delivered('facebook', OLD('facebook'))]
    await edit()
    const fresh = db.logs.filter((r) => r.id.startsWith('new-'))
    expect(media(fresh)).toEqual(['facebook', 'instagram', 'threads'])
    expect(fresh.every((r) => r.approved_at !== null && r.content === `本文-${r.medium}`)).toBe(true)
    expect(db.dispatched).toHaveLength(3)
    expect(db.takedowns).toHaveLength(3)
    expect(db.takedowns.every((t) => t.reason === 'superseded' && String(t.log_id).startsWith('old-'))).toBe(true)
    expect(db.takedowns.find((t) => t.medium === 'threads')).toMatchObject({ posted_id: 'pid-threads', target_id: POST })
    // 古い版の記録そのものは消さない
    expect(db.logs.filter((r) => r.id.startsWith('old-'))).toHaveLength(3)
  })

  it('カウントダウンの日数だけが違う（紹介文は同じ）なら、出し直さない', async () => {
    db.logs = [delivered('threads', '⏳ 掲載終了まであと31日（11/4まで）\n本文-threads')]
    await edit()
    expect(db.dispatched).toHaveLength(0)
    expect(db.takedowns).toHaveLength(0)
  })

  it('前回の配信から24時間以内なら、変わっていても出し直さない（連投を防ぐ）', async () => {
    db.logs = [delivered('threads', OLD('threads'), 3)]
    await edit()
    expect(db.dispatched).toHaveLength(0)
    expect(db.takedowns).toHaveLength(0)
  })

  it('全自動モードがオフなら、承認なしでは出さない', async () => {
    db.autoEnabled = false
    db.logs = [delivered('threads', OLD('threads'))]
    await edit()
    expect(db.dispatched).toHaveLength(0)
    expect(db.takedowns).toHaveLength(0)
    // 配信済みの Threads には何も足さない（未配信の Facebook・Instagram に承認待ちの下書きができるのは従来どおり）
    expect(db.logs.filter((r) => r.medium === 'threads')).toHaveLength(1)
    expect(db.logs.filter((r) => r.id.startsWith('new-')).every((r) => r.approved_at === null)).toBe(true)
  })

  it('配信できなかった媒体は、古い版を削除待ちに載せない（古い版が最新のまま）', async () => {
    db.failMedia = ['instagram']
    db.logs = [delivered('threads', OLD('threads')), delivered('instagram', OLD('instagram'))]
    await edit()
    expect(db.takedowns.map((t) => t.medium)).toEqual(['threads'])
  })

  it('SNS紹介を許可していない掲載は、出し直さない', async () => {
    db.logs = [delivered('threads', OLD('threads'))]
    await edit(false)
    expect(db.dispatched).toHaveLength(0)
  })
})
