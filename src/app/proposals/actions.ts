'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { bindingMeta, STRONG_SUPPORT_CHOICE } from '@/lib/categories'
import { nameWithSan } from '@/lib/honorific'
import { insertNotification, notifyAllMembers } from '@/lib/notify'

type CreateInput = {
  title: string
  body: string
  category: string
  binding_type: 'internal' | 'hosted' | 'external'
  budget_size: 'small' | 'medium' | 'large'
  implementation_date: string  // YYYY-MM-DD
  related_links: string[]
  // 投票締切の個別指定（YYYY-MM-DD）。空なら投票開始が属する四半期の末日が使われる
  voting_deadline_override: string | null
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

  // 締切の個別指定は未来日のみ有効。過去日・空文字は null にして
  // DB 側（start_voting_if_due）の四半期末デフォルトに委ねる
  const deadline = (input.voting_deadline_override ?? '').trim()
  const validDeadline =
    /^\d{4}-\d{2}-\d{2}$/.test(deadline) && new Date(`${deadline}T23:59:59+09:00`) > new Date()
      ? deadline
      : null

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
      voting_deadline_override: validDeadline,
      status: 'discussion',
      discussion_start_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`提案作成に失敗: ${error.message}`)

  // 全メンバーへ新着通知（ベル＋Webプッシュ）。議論期間に参加してもらうための入口
  after(async () => {
    await notifyAllMembers({
      kind: 'proposal',
      actorId: user.id,
      title: `新しい提案「${input.title}」が投稿されました`,
      body: '議論期間中です。コメントで意見を寄せられます',
      linkUrl: `/proposals/${data.id}`,
    })
  })

  revalidatePath('/proposals')
  redirect(`/proposals/${data.id}`)
}

/**
 * 投票する（同じ提案に投票済みなら上書き）。
 *
 * discloseIdentity は「大賛成（是非協力したい）」のときだけ意味を持ち、
 * true なら提案者に名前を伝えて連絡できる状態にする。それ以外の選択肢、
 * および名乗らない場合は従来どおり誰が投票したかを伝えない。
 */
export async function castVote(
  proposalId: string,
  choice: string,
  discloseIdentity = false
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 本番ビルドでは server action が投げた例外の本文がクライアントに渡らず
  // 「An error occurred in the Server Components render」しか出ないため、
  // 失敗理由は戻り値で返して画面に表示できるようにする
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '未ログインです' }

  // proposal の binding_type に応じた choice 検証
  const { data: proposal } = await supabase
    .from('proposals')
    .select('binding_type, status, voting_start_at, voting_end_at')
    .eq('id', proposalId)
    .single()
  if (!proposal) return { ok: false, error: '提案が見つかりません' }
  if (proposal.status !== 'voting') return { ok: false, error: '投票期間外です' }

  const meta = bindingMeta(proposal.binding_type)
  if (!meta || !(meta.choices as readonly string[]).includes(choice)) {
    return { ok: false, error: `不正な投票選択肢: ${choice}` }
  }

  // 名乗り出は「大賛成」のときだけ有効
  const disclose = choice === STRONG_SUPPORT_CHOICE && discloseIdentity

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
        disclose_identity: disclose,
      },
      { onConflict: 'proposal_id,voter_id' }
    )
  if (error) return { ok: false, error: `投票の保存に失敗しました: ${error.message}` }

  // アプリ内通知（best-effort）：提案者へ
  const { data: forNotify } = await supabase
    .from('proposals')
    .select('proposer_id, title')
    .eq('id', proposalId)
    .single()
  if (forNotify && forNotify.proposer_id !== user.id) {
    if (disclose) {
      // 本人が名乗ることを選んだ場合のみ、名前つきで知らせる
      const { data: me } = await supabase
        .from('members')
        .select('display_name')
        .eq('id', user.id)
        .single()
      await insertNotification({
        recipientId: forNotify.proposer_id,
        actorId: user.id,
        kind: 'vote',
        title: `${nameWithSan(me?.display_name)}が提案「${forNotify.title}」に大賛成し、協力したいと名乗り出ました`,
        body: '提案ページからメッセージのやりとりができます',
        linkUrl: `/proposals/${proposalId}`,
      })
    } else {
      // 投票の秘密のため誰が投票したかは載せない
      await insertNotification({
        recipientId: forNotify.proposer_id,
        // actor_id は保存しない（通知行から投票者が特定できてしまうため）
        kind: 'vote',
        title: `あなたの提案「${forNotify.title}」に新しい投票がありました`,
        linkUrl: `/proposals/${proposalId}`,
      })
    }
  }

  revalidatePath(`/proposals/${proposalId}`)
  return { ok: true }
}

export async function retractVote(
  proposalId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '未ログインです' }

  const { error } = await supabase
    .from('votes')
    .update({ retracted_at: new Date().toISOString() })
    .eq('proposal_id', proposalId)
    .eq('voter_id', user.id)
    .is('retracted_at', null)

  if (error) return { ok: false, error: `撤回に失敗しました: ${error.message}` }
  revalidatePath(`/proposals/${proposalId}`)
  return { ok: true }
}

/**
 * 運営（管理者）による投票締切の延長。
 * 諮問で集計済（closed）の提案は投票中に戻して再開する。
 * 権限チェック・状態チェックは DB 関数 extend_voting（SECURITY DEFINER）側で行う。
 */
export async function extendVoting(
  proposalId: string,
  newEnd: string  // YYYY-MM-DD（この日の 23:59 JST が新しい締切）
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '未ログインです' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newEnd)) {
    return { ok: false, error: '日付の形式が不正です' }
  }

  // 通知文言（再開/延長）の判定用に、実行前の状態とタイトルを取得しておく
  const { data: before } = await supabase
    .from('proposals')
    .select('title, status')
    .eq('id', proposalId)
    .single()

  const { data, error } = await supabase.rpc('extend_voting', {
    p_proposal_id: proposalId,
    p_new_end: newEnd,
  })
  if (error) return { ok: false, error: `延長に失敗しました: ${error.message}` }

  const MSG: Record<string, string> = {
    'error:not_admin':      '管理者権限がありません',
    'error:not_found':      '提案が見つかりません',
    'error:not_extendable': 'この提案は延長できません（可決・否決済み、または議論中）',
    'error:past_date':      '過去の日付には設定できません',
    'error:not_later':      '現在の締切より後の日付を指定してください',
  }
  if (typeof data === 'string' && data !== 'extended') {
    return { ok: false, error: MSG[data] ?? `延長できませんでした（${data}）` }
  }

  // 全メンバーへ再開/延長を通知（ベル＋Webプッシュ）。運営操作なので実行者本人は除外
  const wasReopen = before?.status === 'closed'
  const title = before?.title ?? ''
  const [, m, d] = newEnd.split('-')
  const endLabel = `${Number(m)}月${Number(d)}日 23:59`
  after(async () => {
    await notifyAllMembers({
      kind: 'proposal',
      actorId: user.id,
      title: wasReopen
        ? `提案「${title}」の投票が再開されました`
        : `提案「${title}」の投票締切が延長されました`,
      body: `新しい締切は ${endLabel} です。まだの方はぜひご参加ください`,
      linkUrl: `/proposals/${proposalId}`,
    })
  })

  revalidatePath(`/proposals/${proposalId}`)
  revalidatePath('/proposals')
  return { ok: true }
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

  // 字数下限は撤廃（2026-07-25）。何字でも投稿可。
  // 貢献度ポイントの付与条件（コメント50字以上・質問30字以上）はDBトリガー
  // award_on_comment 側で判定する（仕様§3.4.1）
  const trimmed = input.body.trim()
  if (trimmed.length < 1) {
    throw new Error('本文を入力してください')
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
  const actorName = nameWithSan(me?.display_name)
  const kindLabel = { question: '質問', answer: '回答', comment: 'コメント' }[input.kind]
  const preview = trimmed.slice(0, 80) + (trimmed.length > 80 ? '…' : '')
  if (proposal) {
    await insertNotification({
      recipientId: proposal.proposer_id,
      actorId: user.id,
      kind: 'comment',
      title: `あなたの提案「${proposal.title}」に${actorName}から${kindLabel}が届きました`,
      body: preview,
      linkUrl: `/proposals/${input.proposalId}`,
    })
  }
  if (input.recipientId && input.recipientId !== proposal?.proposer_id) {
    await insertNotification({
      recipientId: input.recipientId,
      actorId: user.id,
      kind: 'comment',
      title: `${actorName}からあなた宛の${kindLabel}が届きました`,
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
        title: `${actorName}があなたの投稿に返信しました`,
        body: preview,
        linkUrl: `/proposals/${input.proposalId}`,
      })
    }
  }

  revalidatePath(`/proposals/${input.proposalId}`)
}

/**
 * コメント削除。RLSで「本人」または「committee/super管理者」のみ削除できる。
 * parent_id は ON DELETE CASCADE のため、返信も一緒に削除される。
 */
export async function deleteComment(commentId: string, proposalId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: deleted, error } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId)
    .select('id')
  if (error) throw new Error(`削除に失敗: ${error.message}`)
  if (!deleted || deleted.length === 0) {
    throw new Error('削除できませんでした（権限がありません）')
  }

  revalidatePath(`/proposals/${proposalId}`)
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
        title: `${nameWithSan(me?.display_name)}があなたの投稿に👍いいねしました`,
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
