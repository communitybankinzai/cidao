// 投稿の自動類別の実行（2026-11-22）。各入口（催し・FreeFree・団体・提案・コメント）の after() の中から呼ぶ。
//
//   ・投稿者の画面の待ち時間は増やさない（呼び出し側は after() の中で呼ぶ）
//   ・運営（admin_role あり）の投稿は類別しない
//   ・類別に失敗したとき（AI の障害・上限・10秒の時間切れ）は止めない。error として行を残し、運営の一覧で分かるようにする
//   ・止める（hold）のは、確度が高い重い区分だけ。止める前の状態を行に残し、運営が「問題なし」としたら元に戻す
//   ・「止めた」記録（content_reviews の行）を先に作ってから止める。記録の無いまま止まった投稿を作らない
//   ・この関数は例外を投げない（失敗しても投稿そのものは成立させる）

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { anthropicClient, needsWorkspaceHeader } from '@/lib/disaster-sns-road-ai'
import { estimateCost, unavailableCost } from '@/lib/ai/pricing'
import { recordApiUsage } from '@/lib/talent-bank/usage'
import { buildVisibilityUpdate } from '@/lib/org-visibility'
import {
  CONTENT_REVIEW_MODEL, CONTENT_REVIEW_PURPOSE, CONTENT_REVIEW_SETTING,
  canHoldTarget, classifyContent, decideVerdict, limitReached, parseSetting, targetPath, titleSnapshot, verdictForTarget,
  type ClassifyResult, type ReviewAction, type ReviewTargetType,
} from '@/lib/content-review'
import { notifyAdminsOfReview, notifyAuthorOfHold } from '@/lib/content-review-notify'

export type ReviewRequest = {
  targetType: ReviewTargetType
  targetId: string
  action: ReviewAction
  authorId: string
  /** 題名（コメントのように題名が無いものは null・本文の先頭を使う） */
  title: string | null
  /** 類別する文（buildReviewText で組み立てたもの） */
  text: string
  /** コメントの親（FreeFree の掲載 id／提案 id） */
  parentId?: string | null
  /** 同じ内容でまとめて登録した催し（複数日程）の、ほかの id。止めるときは全部まとめて止める */
  extraTargetIds?: string[]
}

export type ReviewOutcome = { held: boolean; verdict: 'ok' | 'notify' | 'hold' | 'error' | 'skipped' }

export type ReviewDeps = {
  db: SupabaseClient
  classify: (text: string) => Promise<{ result: ClassifyResult; usage: { input: number; output: number } }>
  recordUsage: (memberId: string, usage: { input: number; output: number }) => Promise<void>
  notifyAdmins: typeof notifyAdminsOfReview
  notifyAuthor: typeof notifyAuthorOfHold
}

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ---------- 止める・戻す（入口ごとの分岐。純粋な部分は試験できるよう分けてある） ----------

export type HoldState = Record<string, unknown>
type HoldType = 'event' | 'freefree' | 'org' | 'proposal'

const HOLD_TABLE: Record<HoldType, { table: string; select: string }> = {
  event: { table: 'events', select: 'status' },
  freefree: { table: 'freefree_posts', select: 'status' },
  org: { table: 'organizations', select: 'public_flag, hidden_by_admin, hidden_reason, hidden_at' },
  proposal: { table: 'proposals', select: 'status' },
}

export const ORG_HOLD_REASON = '投稿の自動確認で公開を止めました（運営の審査待ち）'

/** いま公開されていて、止めてよい状態か（すでに非公開・下書き・申告中のものは止めない） */
export function isHoldable(type: HoldType, row: HoldState | null): boolean {
  if (!row) return false
  switch (type) {
    case 'event': return row.status !== 'draft'
    case 'freefree': return row.status === 'active'
    case 'org': return row.public_flag === true
    case 'proposal': return row.status === 'discussion'
  }
}

/** 止める更新の中身 */
export function holdUpdate(type: HoldType, nowIso: string): Record<string, unknown> {
  switch (type) {
    case 'event': return { status: 'draft' }
    case 'freefree': return { status: 'pending' }
    case 'org': {
      const b = buildVisibilityUpdate(false, ORG_HOLD_REASON, new Date(nowIso))
      return b.ok ? { ...b.update, updated_at: nowIso } : {}
    }
    case 'proposal': return { status: 'draft' }
  }
}

/** 止めている状態か（元に戻す前の確かめ。運営がほかの画面で状態を変えていたら戻さない） */
export function isHeldState(type: HoldType, row: HoldState | null): boolean {
  if (!row) return false
  switch (type) {
    case 'event': return row.status === 'draft'
    case 'freefree': return row.status === 'pending'
    case 'org': return row.public_flag === false && row.hidden_by_admin === true
    case 'proposal': return row.status === 'draft'
  }
}

/** 元に戻す更新の中身（提案は議論期間を、公開に戻した時点から数え直す） */
export function restoreUpdate(type: HoldType, prev: HoldState | null, nowIso: string): Record<string, unknown> {
  switch (type) {
    case 'event': return { status: typeof prev?.status === 'string' ? prev.status : 'open' }
    case 'freefree': return { status: 'active' }
    case 'org': {
      const b = buildVisibilityUpdate(true, '')
      return b.ok ? { ...b.update, updated_at: nowIso } : {}
    }
    case 'proposal': return { status: typeof prev?.status === 'string' ? prev.status : 'discussion', discussion_start_at: nowIso }
  }
}

function holdType(t: ReviewTargetType): HoldType | null {
  return canHoldTarget(t) ? (t as HoldType) : null
}

/** 対象の、いまの状態を読む（止めてよいか・元に戻すための記録） */
export async function readHoldState(db: SupabaseClient, type: HoldType, id: string): Promise<HoldState | null> {
  const { data, error } = await db.from(HOLD_TABLE[type].table).select(HOLD_TABLE[type].select).eq('id', id).maybeSingle()
  if (error || !data) return null
  return data as unknown as HoldState
}

/** 止める。止められたら true（すでに状態が変わっていて1行も更新できなかったときは false） */
export async function applyHold(db: SupabaseClient, type: HoldType, ids: string[], nowIso: string): Promise<boolean> {
  let q = db.from(HOLD_TABLE[type].table).update(holdUpdate(type, nowIso)).in('id', ids)
  // 読んだあとに運営が状態を変えていたら上書きしない
  if (type === 'event') q = q.neq('status', 'draft')
  else if (type === 'freefree') q = q.eq('status', 'active')
  else if (type === 'org') q = q.eq('public_flag', true)
  else q = q.eq('status', 'discussion')
  const { data, error } = await q.select('id')
  return !error && (data?.length ?? 0) > 0
}

/** 元に戻す。changed=false は「すでに状態が変わっていたので触らなかった」 */
export async function restoreHold(
  db: SupabaseClient, type: HoldType, id: string, prev: HoldState | null, nowIso: string,
): Promise<{ ok: boolean; changed: boolean }> {
  const ids = Array.isArray(prev?.ids) ? (prev.ids as string[]) : [id]
  let changedAny = false
  for (const one of ids) {
    const cur = await readHoldState(db, type, one)
    if (!cur) continue // 投稿が消えている
    if (!isHeldState(type, cur)) continue // 運営がほかの画面で状態を変えている
    const { data, error } = await db.from(HOLD_TABLE[type].table).update(restoreUpdate(type, prev, nowIso)).eq('id', one).select('id')
    if (error) return { ok: false, changed: changedAny }
    if ((data?.length ?? 0) > 0) changedAny = true
  }
  return { ok: true, changed: changedAny }
}

// ---------- 類別の実行 ----------

function jstMidnightIso(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  return new Date(`${jst}T00:00:00+09:00`).toISOString()
}

async function defaultClassify(text: string) {
  let client = anthropicClient()
  try {
    return await classifyContent(client, text)
  } catch (e) {
    if (!needsWorkspaceHeader(e)) throw e
    client = anthropicClient(true)
    return await classifyContent(client, text)
  }
}

async function defaultRecordUsage(memberId: string, usage: { input: number; output: number }): Promise<void> {
  const u = { input_tokens: usage.input, output_tokens: usage.output, cache_creation_tokens: 0, cache_read_tokens: 0 }
  const cost = await estimateCost({ model: CONTENT_REVIEW_MODEL, usage: u }).catch(() => unavailableCost())
  await recordApiUsage({
    run_id: randomUUID(), case_id: null, subject_id: null, member_id: memberId,
    provider: 'anthropic', model: CONTENT_REVIEW_MODEL, purpose: CONTENT_REVIEW_PURPOSE,
    input_tokens: usage.input, output_tokens: usage.output, cache_creation_tokens: 0, cache_read_tokens: 0, ...cost, error: null,
  })
}

/** 失敗の理由（画面に出す短い日本語。SDK のエラー文はそのまま出さない） */
export function failureReason(e: unknown): string {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : ''
  if (/timeout|timed out|abort/i.test(msg)) return '類別に失敗した（時間切れ）'
  if (/ANTHROPIC_API_KEY/.test(msg)) return '類別に失敗した（AI の設定がありません）'
  return '類別に失敗した（AI の障害の可能性）'
}

export async function reviewPost(req: ReviewRequest, deps: Partial<ReviewDeps> = {}): Promise<ReviewOutcome> {
  const db = deps.db ?? serviceClient()
  if (!db) return { held: false, verdict: 'error' }
  const classify = deps.classify ?? defaultClassify
  const recordUsage = deps.recordUsage ?? defaultRecordUsage
  const notifyAdmins = deps.notifyAdmins ?? notifyAdminsOfReview
  const notifyAuthor = deps.notifyAuthor ?? notifyAuthorOfHold

  try {
    // 運営の投稿は類別しない
    const { data: author } = await db.from('members').select('admin_role').eq('id', req.authorId).maybeSingle()
    if (author?.admin_role) return { held: false, verdict: 'skipped' }

    // 編集で、すでに止めている投稿は、もう一度読まない（運営が最新の内容を見て決める）
    if (req.action === 'update') {
      const { data: open } = await db.from('content_reviews').select('id').eq('target_type', req.targetType).eq('target_id', req.targetId)
        .eq('status', 'open').eq('held', true).limit(1)
      if (open && open.length > 0) return { held: true, verdict: 'skipped' }
    }

    const { data: setting } = await db.from('app_settings').select('value').eq('key', CONTENT_REVIEW_SETTING).maybeSingle()
    const cfg = parseSetting(setting?.value)
    if (!cfg.enabled) return { held: false, verdict: 'skipped' }

    const title = titleSnapshot(req.title, req.text)
    const base = {
      target_type: req.targetType, target_id: req.targetId, parent_id: req.parentId ?? null, action: req.action,
      author_id: req.authorId, title_snapshot: title, model: CONTENT_REVIEW_MODEL, status: 'open',
    }
    const recordError = async (reason: string): Promise<ReviewOutcome> => {
      const { error } = await db.from('content_reviews').insert({ ...base, verdict: 'error', categories: [], held: false, reason })
      if (error) console.error('[content-review] error row failed:', error.message)
      return { held: false, verdict: 'error' }
    }

    // 1日の上限（超えたら止めずに error として残す）
    const { count } = await db.from('api_usage').select('id', { count: 'exact', head: true })
      .eq('purpose', CONTENT_REVIEW_PURPOSE).gte('created_at', jstMidnightIso())
    if (limitReached(count ?? 0, cfg.dailyLimit)) return await recordError(`類別できなかった（1日の上限 ${cfg.dailyLimit} 回に達した）`)

    let r: Awaited<ReturnType<typeof classify>>
    try {
      r = await classify(req.text)
    } catch (e) {
      console.warn('[content-review] classify failed:', e instanceof Error ? e.name : '')
      return await recordError(failureReason(e))
    }
    await recordUsage(req.authorId, r.usage).catch(() => undefined)

    const verdict = verdictForTarget(decideVerdict(r.result.categories, r.result.confidence), req.targetType)
    if (verdict === 'ok') return { held: false, verdict: 'ok' }

    const common = { ...base, categories: r.result.categories, confidence: r.result.confidence, reason: r.result.reason || null }
    const link = targetPath(req.targetType, req.targetId, req.parentId)
    const notice = { targetType: req.targetType, title, categories: r.result.categories, reason: r.result.reason }

    // 止める場合：いまの状態を読み、「止めた記録」を先に作ってから止める
    const type = verdict === 'hold' ? holdType(req.targetType) : null
    if (type) {
      const ids = [req.targetId, ...(req.extraTargetIds ?? [])]
      const state = await readHoldState(db, type, req.targetId)
      if (isHoldable(type, state)) {
        const prev: HoldState = { ...(state as HoldState), ...(ids.length > 1 ? { ids } : {}) }
        const { data: row, error } = await db.from('content_reviews').insert({ ...common, verdict: 'hold', held: true, prev_state: prev }).select('id').single()
        if (!error && row) {
          const ok = await applyHold(db, type, ids, new Date().toISOString()).catch(() => false)
          if (ok) {
            await notifyAdmins(db, { ...notice, held: true })
            await notifyAuthor(req.authorId, link)
            return { held: true, verdict: 'hold' }
          }
          // 止められなかった（状態が変わっていた・更新に失敗）→ 公開のまま知らせるだけに落とす
          await db.from('content_reviews').update({ verdict: 'notify', held: false, prev_state: null, reason: `${r.result.reason || ''}（自動では止められませんでした）`.slice(0, 250) }).eq('id', row.id)
          await notifyAdmins(db, { ...notice, held: false })
          return { held: false, verdict: 'notify' }
        }
        console.error('[content-review] hold row failed (not holding):', error?.message)
        return { held: false, verdict: 'error' }
      }
    }

    // 公開したまま知らせる（軽い区分・確度が高くない重い区分・止められない入口・すでに公開されていない投稿）
    const { error } = await db.from('content_reviews').insert({ ...common, verdict: 'notify', held: false })
    if (error) console.error('[content-review] notify row failed:', error.message)
    await notifyAdmins(db, { ...notice, held: false })
    return { held: false, verdict: 'notify' }
  } catch (e) {
    console.error('[content-review] failed:', e instanceof Error ? e.message : e)
    return { held: false, verdict: 'error' }
  }
}
