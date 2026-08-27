'use server'

// 電子決裁の Server Actions（起案・押印・取消・取り下げ・本文修正）。
//
// 決裁テーブルは authenticated に SELECT しか GRANT していないため、
// 書き込みはすべてここで本人確認・役員確認をしたうえで service_role で行う。
// 判定ロジック（定足数・可決・当事者除外）は src/lib/approval.ts に集約。

import { createHash, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseAdmin, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  evaluateRequest,
  pickRule,
  type ApprovalCategory,
  type ApprovalRequest,
  type ApprovalRule,
  type ApprovalStamp,
  type Officer,
} from '@/lib/approval'

const CATEGORIES: ApprovalCategory[] = ['project', 'expense', 'document', 'conflict_of_interest']

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('サーバー接続が未設定です')
  return createSupabaseAdmin(url, key, { auth: { persistSession: false } })
}

// ログイン中のユーザーが役員であることを確認して返す。
// LINE 認証済み＝役員ではない（officer_role は管理者が手動付与）。
async function requireOfficer(): Promise<{ officer: Officer; service: SupabaseClient }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ログインしてください')
  const service = serviceClient()
  const { data: member, error } = await service
    .from('members')
    .select('id, display_name, officer_role, deleted_at')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!member || member.deleted_at || !member.officer_role) {
    throw new Error('役員のみ利用できます（役員区分が未設定です）')
  }
  return {
    officer: {
      id: member.id as string,
      display_name: member.display_name as string,
      officer_role: member.officer_role as Officer['officer_role'],
    },
    service,
  }
}

async function fetchOfficers(service: SupabaseClient): Promise<Officer[]> {
  const { data, error } = await service
    .from('members')
    .select('id, display_name, officer_role')
    .not('officer_role', 'is', null)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  return (data ?? []) as Officer[]
}

async function fetchRules(service: SupabaseClient): Promise<ApprovalRule[]> {
  const { data, error } = await service.from('approval_rules').select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as ApprovalRule[]
}

function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

// 決裁状況を再計算し、可決・却下が確定していれば status を更新する。
// 期限超過は status を変えない（みなし承認はしない。「期限超過」の表示のみ）。
async function recomputeStatus(service: SupabaseClient, requestId: string): Promise<void> {
  const { data: req, error } = await service
    .from('approval_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!req || req.status !== 'pending') return
  const request = req as ApprovalRequest
  const rules = await fetchRules(service)
  const rule = pickRule(rules, request.category, request.created_at)
  if (!rule) return
  const officers = await fetchOfficers(service)
  const { data: stampRows, error: sErr } = await service
    .from('approval_stamps')
    .select('*')
    .eq('request_id', requestId)
  if (sErr) throw new Error(sErr.message)
  const evaluation = evaluateRequest(request, rule, officers, (stampRows ?? []) as ApprovalStamp[])
  if (evaluation.outcome === 'pending') return
  const { error: uErr } = await service
    .from('approval_requests')
    .update({ status: evaluation.outcome, decided_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending')
  if (uErr) throw new Error(uErr.message)
}

export type ApprovalActionResult = { ok: true; id?: string } | { ok: false; error: string }

// ---------- 起案 ----------
// 添付は起案フォーム（クライアント）から非公開バケットへ直接アップロード済みの
// パスを受け取る（Server Actions の 1MB ボディ制限を避けるため。RLS で役員のみ可）。
export type AttachmentInput = { path: string; name: string; size: number }

export async function createRequest(input: {
  title: string
  category: string
  body: string
  amount: number | null
  conflictNote: string
  conflictOfficerIds: string[]
  attachments: AttachmentInput[]
}): Promise<ApprovalActionResult> {
  try {
    const { officer, service } = await requireOfficer()

    const title = (input.title ?? '').trim()
    const body = (input.body ?? '').trim()
    const category = input.category as ApprovalCategory
    if (!CATEGORIES.includes(category)) return { ok: false, error: '決裁区分を選んでください' }
    if (title.length < 1 || title.length > 100) return { ok: false, error: '件名は1〜100文字で入力してください' }
    if (body.length < 1 || body.length > 10000) return { ok: false, error: '本文は1〜10,000文字で入力してください' }

    let amount: number | null = null
    if (category === 'expense') {
      const n = Math.round(Number(input.amount))
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: '金額を入力してください（0以上の整数・円）' }
      amount = n
    }

    const officers = await fetchOfficers(service)
    const officerIds = new Set(officers.map((o) => o.id))
    let conflictOfficerIds: string[] = []
    let conflictNote: string | null = null
    if (category === 'conflict_of_interest') {
      conflictOfficerIds = Array.from(new Set(input.conflictOfficerIds ?? [])).filter((id) =>
        officerIds.has(id)
      )
      conflictNote = (input.conflictNote ?? '').trim() || null
      if (!conflictNote) {
        return { ok: false, error: '利益相反の関係の内容を記入してください（決裁規程 第6条）' }
      }
    }

    // 添付: クライアントが直接アップロードしたパスのみ受ける（形式を検査）
    const attachments = (input.attachments ?? [])
      .filter((a) => typeof a?.path === 'string' && /^[0-9a-f-]{36}\/[^/]{1,200}$/.test(a.path))
      .slice(0, 10)
      .map((a) => ({ path: a.path, name: String(a.name ?? '').slice(0, 200), size: Number(a.size) || 0 }))

    const id = randomUUID()
    const { error } = await service.from('approval_requests').insert({
      id,
      title,
      category,
      body,
      amount,
      requested_by: officer.id,
      status: 'pending',
      body_hash: hashBody(body),
      conflict_officer_ids: conflictOfficerIds,
      conflict_note: conflictNote,
      attachments,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/admin/approvals')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 押印（承認・却下・保留） ----------
export async function stampRequest(
  requestId: string,
  action: 'approve' | 'reject' | 'hold',
  comment: string
): Promise<ApprovalActionResult> {
  try {
    const { officer, service } = await requireOfficer()
    if (!['approve', 'reject', 'hold'].includes(action)) return { ok: false, error: '不正な操作です' }
    if (officer.officer_role === 'auditor') {
      return { ok: false, error: '監査役は押印できません（全件の閲覧のみ）' }
    }

    const { data: req, error } = await service
      .from('approval_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!req) return { ok: false, error: '案件が見つかりません' }
    const request = req as ApprovalRequest
    if (request.status !== 'pending') {
      return { ok: false, error: 'この案件は決裁が終了しています（押印できるのは決裁中のみ）' }
    }

    const rules = await fetchRules(service)
    const rule = pickRule(rules, request.category, request.created_at)
    if (!rule) return { ok: false, error: 'この区分の決裁基準が未設定です（approval_rules を確認）' }

    // 利益相反の当事者（起案者＋指定役員）は押印できない
    if (rule.exclude_involved) {
      const excluded = new Set([request.requested_by, ...request.conflict_officer_ids])
      if (excluded.has(officer.id)) {
        return { ok: false, error: '利益相反の当事者は押印できません（決裁規程 第5条第3項）' }
      }
    }

    const trimmed = (comment ?? '').trim().slice(0, 1000)
    // stamped_at はサーバー側トリガで now() に固定される（クライアント時刻は不使用）
    const { error: iErr } = await service.from('approval_stamps').insert({
      id: randomUUID(),
      request_id: requestId,
      member_id: officer.id,
      officer_role: officer.officer_role,
      action,
      comment: trimmed || null,
      body_hash: request.body_hash,
    })
    if (iErr) throw new Error(iErr.message)

    await recomputeStatus(service, requestId)
    revalidatePath('/admin/approvals')
    revalidatePath(`/admin/approvals/${requestId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 押印の取消 ----------
// 電子印は書き換え不可（追記のみ）なので、action='revoke' のレコードを積む。
export async function revokeStamp(requestId: string): Promise<ApprovalActionResult> {
  try {
    const { officer, service } = await requireOfficer()
    const { data: req, error } = await service
      .from('approval_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!req) return { ok: false, error: '案件が見つかりません' }
    const request = req as ApprovalRequest
    if (request.status !== 'pending') {
      return { ok: false, error: '決裁が終了した案件の押印は取り消せません' }
    }

    const { data: mine, error: sErr } = await service
      .from('approval_stamps')
      .select('action')
      .eq('request_id', requestId)
      .eq('member_id', officer.id)
      .order('stamped_at', { ascending: false })
      .limit(1)
    if (sErr) throw new Error(sErr.message)
    if (!mine || mine.length === 0 || mine[0].action === 'revoke') {
      return { ok: false, error: '取り消せる押印がありません' }
    }

    const { error: iErr } = await service.from('approval_stamps').insert({
      id: randomUUID(),
      request_id: requestId,
      member_id: officer.id,
      officer_role: officer.officer_role,
      action: 'revoke',
      comment: null,
      body_hash: request.body_hash,
    })
    if (iErr) throw new Error(iErr.message)

    revalidatePath('/admin/approvals')
    revalidatePath(`/admin/approvals/${requestId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 取り下げ（起案者のみ） ----------
export async function withdrawRequest(requestId: string): Promise<ApprovalActionResult> {
  try {
    const { officer, service } = await requireOfficer()
    const { data: updated, error } = await service
      .from('approval_requests')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('requested_by', officer.id)
      .eq('status', 'pending')
      .select('id')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) {
      return { ok: false, error: '取り下げできませんでした（起案者本人の決裁中案件のみ取り下げ可能です）' }
    }
    revalidatePath('/admin/approvals')
    revalidatePath(`/admin/approvals/${requestId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 本文の修正（起案者のみ・決裁中のみ） ----------
// body_hash が変わるため、修正前の押印はすべて「本文変更前の押印」として
// 無効になる（各役員が押し直す。改ざん防止: 設計方針 4章）。
export async function updateRequestBody(requestId: string, newBody: string): Promise<ApprovalActionResult> {
  try {
    const { officer, service } = await requireOfficer()
    const body = (newBody ?? '').trim()
    if (body.length < 1 || body.length > 10000) {
      return { ok: false, error: '本文は1〜10,000文字で入力してください' }
    }
    const { data: req, error } = await service
      .from('approval_requests')
      .select('id, requested_by, status, body')
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!req) return { ok: false, error: '案件が見つかりません' }
    if (req.requested_by !== officer.id) return { ok: false, error: '本文を修正できるのは起案者のみです' }
    if (req.status !== 'pending') return { ok: false, error: '決裁が終了した案件は修正できません' }
    if (req.body === body) return { ok: false, error: '本文に変更がありません' }

    const { error: uErr } = await service
      .from('approval_requests')
      .update({ body, body_hash: hashBody(body) })
      .eq('id', requestId)
      .eq('status', 'pending')
    if (uErr) throw new Error(uErr.message)

    revalidatePath('/admin/approvals')
    revalidatePath(`/admin/approvals/${requestId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
