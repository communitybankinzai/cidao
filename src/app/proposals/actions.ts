'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { bindingMeta } from '@/lib/categories'
import { insertNotification } from '@/lib/notify'

type CreateInput = {
  title: string
  body: string
  category: string
  binding_type: 'internal' | 'hosted' | 'external'
  budget_size: 'small' | 'medium' | 'large'
  implementation_date: string  // YYYY-MM-DD
  related_links: string[]
  start_immediately: boolean  // 議論期間スキップして即投票するか（管理者専用、Phase 1 は使わない）
}

export async function createProposal(input: CreateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // tier='light' は提案不可（RLS でも弾かれるが UI 側でも早期エラー）
  const { data: member } = await supabase
    .from('members')
    .select('tier')
    .eq('id', user.id)
    .single()
  if (!member || member.tier === 'light') {
    throw new Error('提案には本登録（メール登録以上）が必要です')
  }

  // status='discussion' で挿入、discussion_start_at = now()
  // voting_start/end は finalize_voting/start_voting_if_due で後ほど設定
  const { data, error } = await supabase
    .from('proposals')
    .insert({
      proposer_id: user.id,
      title: input.title,
      body: input.body,
      category: input.category,
      binding_type: input.binding_type,
      budget_size: input.budget_size,
      implementation_date: input.implementation_date,
      related_links: input.related_links.filter((l) => l.trim().length > 0),
      status: 'discussion',
      discussion_start_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`提案作成に失敗: ${error.message}`)

  revalidatePath('/proposals')
  redirect(`/proposals/${data.id}`)
}

export async function castVote(proposalId: string, choice: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // proposal の binding_type に応じた choice 検証
  const { data: proposal } = await supabase
    .from('proposals')
    .select('binding_type, status, voting_start_at, voting_end_at')
    .eq('id', proposalId)
    .single()
  if (!proposal) throw new Error('提案が見つかりません')
  if (proposal.status !== 'voting') throw new Error('投票期間外です')

  const meta = bindingMeta(proposal.binding_type)
  if (!meta || !(meta.choices as readonly string[]).includes(choice)) {
    throw new Error(`不正な投票選択肢: ${choice}`)
  }

  // upsert（既存票があれば更新、なければ新規）
  const { error } = await supabase
    .from('votes')
    .upsert(
      {
        proposal_id: proposalId,
        voter_id: user.id,
        choice,
        weight: 0,  // トリガー calc_vote_weight が再計算する
        retracted_at: null,
      },
      { onConflict: 'proposal_id,voter_id' }
    )
  if (error) throw new Error(`投票に失敗: ${error.message}`)

  // アプリ内通知（best-effort）：提案者へ。投票の秘密のため誰が投票したかは載せない
  const { data: forNotify } = await supabase
    .from('proposals')
    .select('proposer_id, title')
    .eq('id', proposalId)
    .single()
  if (forNotify && forNotify.proposer_id !== user.id) {
    await insertNotification({
      recipientId: forNotify.proposer_id,
      // actor_id は保存しない（通知行から投票者が特定できてしまうため）
      kind: 'vote',
      title: `あなたの提案「${forNotify.title}」に新しい投票がありました`,
      linkUrl: `/proposals/${proposalId}`,
    })
  }

  revalidatePath(`/proposals/${proposalId}`)
}

export async function retractVote(proposalId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase
    .from('votes')
    .update({ retracted_at: new Date().toISOString() })
    .eq('proposal_id', proposalId)
    .eq('voter_id', user.id)
    .is('retracted_at', null)

  if (error) throw new Error(`撤回に失敗: ${error.message}`)
  revalidatePath(`/proposals/${proposalId}`)
}

export async function finalizeVotingIfDue(proposalId: string) {
  const supabase = await createClient()
  // SECURITY DEFINER pg 関数を呼び出し
  await supabase.rpc('finalize_voting', { p_proposal_id: proposalId })
  await supabase.rpc('start_voting_if_due', { p_proposal_id: proposalId })
}

// ===========================
// 議論機能 F14
// ===========================

type CommentInput = {
  proposalId: string
  kind: 'question' | 'answer' | 'comment'
  body: string
  parentId?: string | null
  recipientId?: string | null
}

export async function postComment(input: CommentInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // 字数制約（仕様§3.4.1 ポイント加算条件と一致）
  // 返信（parentId有り）は会話の流れを妨げないよう1字以上でOK
  const trimmed = input.body.trim()
  const isReply = !!input.parentId
  if (trimmed.length < 1) {
    throw new Error('本文を入力してください')
  }
  if (!isReply && input.kind === 'question' && trimmed.length < 30) {
    throw new Error('質問は30字以上で入力してください')
  }
  if (!isReply && input.kind === 'comment' && trimmed.length < 50) {
    throw new Error('コメントは50字以上で入力してください')
  }

  const { error } = await supabase.from('comments').insert({
    proposal_id: input.proposalId,
    author_id: user.id,
    kind: input.kind,
    body: trimmed,
    parent_id: input.parentId ?? null,
    recipient_id: input.recipientId ?? null,
  })
  if (error) throw new Error(`投稿に失敗: ${error.message}`)

  // アプリ内通知（best-effort）：提案者＋コメント宛先へ。自分自身には飛ばない（insertNotification側で除外）
  const { data: proposal } = await supabase
    .from('proposals')
    .select('proposer_id, title')
    .eq('id', input.proposalId)
    .single()
  const { data: me } = await supabase
    .from('members')
    .select('display_name')
    .eq('id', user.id)
    .single()
  const actorName = me?.display_name ?? 'メンバー'
  const kindLabel = { question: '質問', answer: '回答', comment: 'コメント' }[input.kind]
  const preview = trimmed.slice(0, 80) + (trimmed.length > 80 ? '…' : '')
  if (proposal) {
    await insertNotification({
      recipientId: proposal.proposer_id,
      actorId: user.id,
      kind: 'comment',
      title: `あなたの提案「${proposal.title}」に${actorName}さんから${kindLabel}が届きました`,
      body: preview,
      linkUrl: `/proposals/${input.proposalId}`,
    })
  }
  if (input.recipientId && input.recipientId !== proposal?.proposer_id) {
    await insertNotification({
      recipientId: input.recipientId,
      actorId: user.id,
      kind: 'comment',
      title: `${actorName}さんからあなた宛の${kindLabel}が届きました`,
      body: preview,
      linkUrl: `/proposals/${input.proposalId}`,
    })
  }

  // 返信の場合、返信先コメントの投稿者にも通知（提案者・recipient宛と重複しない場合のみ）
  if (input.parentId) {
    const { data: parent } = await supabase
      .from('comments')
      .select('author_id')
      .eq('id', input.parentId)
      .single()
    if (
      parent &&
      parent.author_id !== user.id &&
      parent.author_id !== proposal?.proposer_id &&
      parent.author_id !== input.recipientId
    ) {
      await insertNotification({
        recipientId: parent.author_id,
        actorId: user.id,
        kind: 'comment',
        title: `${actorName}さんがあなたの投稿に返信しました`,
        body: preview,
        linkUrl: `/proposals/${input.proposalId}`,
      })
    }
  }

  revalidatePath(`/proposals/${input.proposalId}`)
}

/** いいねのトグル。未いいねなら +1、いいね済みなら取り消して -1（comment_likes で1人1回を保証） */
export async function likeComment(commentId: string, proposalId: string): Promise<{ liked: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error: insErr } = await supabase
    .from('comment_likes')
    .insert({ comment_id: commentId, member_id: user.id })

  if (!insErr) {
    await supabase.rpc('adjust_comment_likes', { p_comment_id: commentId, p_delta: 1 })

    // いいねされた本人へ通知（best-effort、取り消し時は通知しない）
    const { data: target } = await supabase
      .from('comments')
      .select('author_id, body')
      .eq('id', commentId)
      .single()
    if (target) {
      const { data: me } = await supabase
        .from('members')
        .select('display_name')
        .eq('id', user.id)
        .single()
      await insertNotification({
        recipientId: target.author_id,
        actorId: user.id,
        kind: 'comment',
        title: `${me?.display_name ?? 'メンバー'}さんがあなたの投稿に👍いいねしました`,
        body: target.body.slice(0, 80) + (target.body.length > 80 ? '…' : ''),
        linkUrl: `/proposals/${proposalId}`,
      })
    }

    revalidatePath(`/proposals/${proposalId}`)
    return { liked: true }
  }

  if (insErr.code === '23505') {
    // 既にいいね済み → 取り消し
    await supabase
      .from('comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('member_id', user.id)
    await supabase.rpc('adjust_comment_likes', { p_comment_id: commentId, p_delta: -1 })
    revalidatePath(`/proposals/${proposalId}`)
    return { liked: false }
  }

  throw new Error(`いいねに失敗: ${insErr.message}`)
}
