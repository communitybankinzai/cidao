'use server'

// 投稿の審査（運営の画面 /admin/review）の操作。
//   ・問題なし … 止めていれば公開に戻す（全会員への通知の出し直しはしない）
//   ・非公開にする／コメントは削除する … 催し・提案は draft のまま、FreeFree は既存の非公開（証拠の保全つき）、団体は運営非公開
// 読み書きは service_role で行い、その前に必ず運営委員・統括であることを確かめる（content_reviews は service_role 専用の表）。
// 操作は content_reviews の decided_by / decided_at と、書き込み記録（audit_logs）に残す。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { recordWrite } from '@/lib/audit'
import { restoreHold, serviceClient, type HoldState } from '@/lib/content-review-run'
import { canHoldTarget, type ReviewTargetType } from '@/lib/content-review'
import { buildVisibilityUpdate } from '@/lib/org-visibility'
import { hideFreefreePost } from '@/app/admin/freefree/actions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireOperator(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: ok } = await supabase.rpc('is_committee_or_super')
  if (!ok) throw new Error('運営委員の権限が必要です')
  return user.id
}

type ReviewRow = {
  id: string
  target_type: ReviewTargetType
  target_id: string
  held: boolean
  prev_state: HoldState | null
  status: string
}

async function loadOpenReview(reviewId: string) {
  if (!UUID_RE.test(reviewId)) throw new Error('審査の指定が正しくありません')
  const db = serviceClient()
  if (!db) throw new Error('サーバー設定エラー（service role 未設定）')
  const { data, error } = await db
    .from('content_reviews')
    .select('id, target_type, target_id, held, prev_state, status')
    .eq('id', reviewId)
    .maybeSingle()
  if (error) throw new Error(`審査を読み込めませんでした: ${error.message}`)
  if (!data) throw new Error('審査が見つかりません')
  const row = data as ReviewRow
  if (row.status !== 'open') throw new Error('この審査はすでに対応済みです')
  return { db, row }
}

function revalidateAll(row: ReviewRow) {
  revalidatePath('/admin/review')
  revalidatePath('/admin')
  if (row.target_type === 'event') { revalidatePath('/events'); revalidatePath(`/events/${row.target_id}`) }
  if (row.target_type === 'freefree') { revalidatePath('/freefree'); revalidatePath(`/freefree/${row.target_id}`) }
  if (row.target_type === 'org') { revalidatePath('/orgs'); revalidatePath(`/orgs/${row.target_id}`) }
  if (row.target_type === 'proposal') { revalidatePath('/proposals'); revalidatePath(`/proposals/${row.target_id}`) }
}

/**
 * 問題なし。止めている投稿は公開に戻す（止めたあとに運営がほかの画面で状態を変えていたら、触らない）。
 * 公開に戻しても、全会員への新着通知・SNS の下書きは出し直さない（v1）。
 */
export async function clearReview(reviewId: string): Promise<void> {
  const operatorId = await requireOperator()
  const { db, row } = await loadOpenReview(reviewId)

  let restored: { ok: boolean; changed: boolean } | null = null
  if (row.held && canHoldTarget(row.target_type)) {
    restored = await restoreHold(db, row.target_type as 'event' | 'freefree' | 'org' | 'proposal', row.target_id, row.prev_state, new Date().toISOString())
    if (!restored.ok) throw new Error('公開に戻せませんでした。時間をおいてもう一度お試しください')
  }

  const { error } = await db
    .from('content_reviews')
    .update({ status: 'cleared', decided_at: new Date().toISOString(), decided_by: operatorId })
    .eq('id', row.id)
    .eq('status', 'open')
  if (error) throw new Error(`記録に失敗しました: ${error.message}`)

  await recordWrite({
    actorId: operatorId, action: 'review.clear', targetType: row.target_type, targetId: row.target_id,
    detail: { review_id: row.id, restored: restored?.changed ?? null }, isAdmin: true,
  })
  revalidateAll(row)
}

/** 非公開にする（止めたままにする）。コメントは削除する */
export async function removeReview(reviewId: string): Promise<void> {
  const operatorId = await requireOperator()
  const { db, row } = await loadOpenReview(reviewId)
  const now = new Date().toISOString()
  const note = '投稿の審査で非公開にしました'

  switch (row.target_type) {
    case 'event': {
      const ids = Array.isArray(row.prev_state?.ids) ? (row.prev_state?.ids as string[]) : [row.target_id]
      const { error } = await db.from('events').update({ status: 'draft' }).in('id', ids)
      if (error) throw new Error(`非公開にできませんでした: ${error.message}`)
      break
    }
    case 'freefree': {
      const { data: post } = await db.from('freefree_posts').select('status').eq('id', row.target_id).maybeSingle()
      // 消えている・すでに非公開なら何もしない。それ以外は既存の非公開（証拠の保全・SNS 削除待ちの作成つき）
      if (post && post.status !== 'removed') await hideFreefreePost(row.target_id, note)
      break
    }
    case 'freefree_comment': {
      const { error } = await db.from('supports').delete().eq('id', row.target_id).eq('kind', 'comment')
      if (error) throw new Error(`コメントを削除できませんでした: ${error.message}`)
      break
    }
    case 'org': {
      const built = buildVisibilityUpdate(false, note, new Date(now))
      if (!built.ok) throw new Error(built.error)
      const { error } = await db.from('organizations').update({ ...built.update, updated_at: now }).eq('id', row.target_id)
      if (error) throw new Error(`非公開にできませんでした: ${error.message}`)
      break
    }
    case 'proposal': {
      const { error } = await db.from('proposals').update({ status: 'draft' }).eq('id', row.target_id)
      if (error) throw new Error(`非公開にできませんでした: ${error.message}`)
      break
    }
    case 'proposal_comment': {
      // 返信（親が消えると一緒に消える設定）も一緒に消える
      const { error } = await db.from('comments').delete().eq('id', row.target_id)
      if (error) throw new Error(`コメントを削除できませんでした: ${error.message}`)
      break
    }
  }

  const { error } = await db
    .from('content_reviews')
    .update({ status: 'removed', decided_at: now, decided_by: operatorId })
    .eq('id', row.id)
    .eq('status', 'open')
  if (error) throw new Error(`記録に失敗しました: ${error.message}`)

  await recordWrite({
    actorId: operatorId, action: 'review.remove', targetType: row.target_type, targetId: row.target_id,
    detail: { review_id: row.id }, isAdmin: true,
  })
  revalidateAll(row)
}
