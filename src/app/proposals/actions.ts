'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { bindingMeta } from '@/lib/categories'

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
