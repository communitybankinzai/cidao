import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { categoryLabel, budgetLabel, bindingMeta } from '@/lib/categories'
import { finalizeVotingIfDue } from '../actions'
import { VoteSection } from './_components/VoteSection'
import { CommentSection } from './_components/CommentSection'
import { LiveLayerBars } from './_components/LiveLayerBars'

const STATUS_LABEL: Record<string, string> = {
  discussion: '議論中',
  voting:     '投票中',
  passed:     '可決',
  rejected:   '否決',
  closed:     '集計済（諮問）',
  draft:      '下書き',
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // 表示前に投票期間判定（48h 経過 → voting、voting_end_at 超過 → 結果確定）
  await finalizeVotingIfDue(id)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: proposal } = await supabase
    .from('proposals')
    .select('*')
    .eq('id', id)
    .single()

  if (!proposal) notFound()

  const meta = bindingMeta(proposal.binding_type)

  // 提案者情報
  const { data: proposer } = await supabase
    .from('members')
    .select('display_name, tier')
    .eq('id', proposal.proposer_id)
    .single()

  // 層別集計
  const { data: aggregates } = await supabase
    .from('vote_aggregates')
    .select('tier, choice, count, weight_total')
    .eq('proposal_id', id)

  // 自分の投票
  let myVote: { choice: string; retracted_at: string | null } | null = null
  if (user) {
    const { data } = await supabase
      .from('votes')
      .select('choice, retracted_at')
      .eq('proposal_id', id)
      .eq('voter_id', user.id)
      .maybeSingle()
    myVote = data
  }

  // コメント・質問・回答（議論 F14）
  const { data: rawComments } = await supabase
    .from('comments')
    .select('id, author_id, kind, parent_id, body, likes, created_at')
    .eq('proposal_id', id)
    .order('created_at', { ascending: true })

  // 投稿者名取得
  const authorIds = Array.from(new Set((rawComments ?? []).map((c) => c.author_id)))
  const { data: authors } = authorIds.length > 0
    ? await supabase
        .from('members')
        .select('id, display_name')
        .in('id', authorIds)
    : { data: [] }
  const nameOf = new Map((authors ?? []).map((a) => [a.id, a.display_name]))

  const comments = (rawComments ?? []).map((c) => ({
    id: c.id,
    author_id: c.author_id,
    author_name: nameOf.get(c.author_id) ?? '匿名',
    kind: c.kind as 'question' | 'answer' | 'comment',
    parent_id: c.parent_id,
    body: c.body,
    likes: c.likes ?? 0,
    created_at: c.created_at,
    is_proposer: c.author_id === proposal.proposer_id,
  }))

  // 議論残り時間 / 投票残り時間
  const now = Date.now()
  const discussionEndsAt = proposal.discussion_start_at
    ? new Date(proposal.discussion_start_at).getTime() + 48 * 3600 * 1000
    : null
  const remainingDiscussionMin = discussionEndsAt ? Math.max(0, Math.floor((discussionEndsAt - now) / 60000)) : null
  const remainingVotingMin = proposal.voting_end_at
    ? Math.max(0, Math.floor((new Date(proposal.voting_end_at).getTime() - now) / 60000))
    : null

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/proposals" className="hover:underline">← 提案一覧</Link>
        </nav>

        <header className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(proposal.category)}</span>
            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">{budgetLabel(proposal.budget_size)}</span>
            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">{meta?.label}</span>
            <span className="px-2 py-1 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 rounded font-semibold">
              {STATUS_LABEL[proposal.status]}
            </span>
          </div>
          <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">
            {proposal.title}
          </h1>
          <p className="text-sm text-slate-500">
            提案者: {proposer?.display_name ?? '匿名'}
            {' · '}
            実施予定: {proposal.implementation_date}
          </p>
        </header>

        {/* 期限情報 */}
        {proposal.status === 'discussion' && remainingDiscussionMin !== null && (
          <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-400 p-4 rounded text-sm">
            議論期間中（残り{Math.floor(remainingDiscussionMin / 60)}時間{remainingDiscussionMin % 60}分）
            <br />
            終了後、自動的に投票期間に移行します（{budgetLabel(proposal.budget_size).split('（')[0]}: {meta?.label.includes('諮問') ? '諮問' : '拘束的'}）
          </div>
        )}
        {proposal.status === 'voting' && remainingVotingMin !== null && (
          <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded text-sm">
            投票期間中（残り {Math.floor(remainingVotingMin / 1440)}日 {Math.floor((remainingVotingMin % 1440) / 60)}時間）
          </div>
        )}

        {/* 本文 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
            {proposal.body}
          </p>

          {proposal.related_links && proposal.related_links.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-500 mb-2">関連リンク</p>
              <ul className="text-sm space-y-1">
                {proposal.related_links.map((link: string, i: number) => (
                  <li key={i}>
                    <a href={link} target="_blank" rel="noopener" className="text-sky-600 dark:text-sky-400 hover:underline break-all">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 投票 UI */}
        {meta && (
          <VoteSection
            proposalId={id}
            status={proposal.status}
            bindingType={proposal.binding_type}
            choices={[...meta.choices]}
            myChoice={myVote && !myVote.retracted_at ? myVote.choice : null}
            isLoggedIn={!!user}
            aggregates={aggregates ?? []}
          />
        )}

        {/* 層別可視化（投票期間中・終了後） */}
        {meta && (proposal.status === 'voting' || proposal.status === 'passed' || proposal.status === 'rejected' || proposal.status === 'closed') && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase mb-4">層別投票状況</h2>
            <LiveLayerBars
              proposalId={id}
              initialAggregates={aggregates ?? []}
              choices={[...meta.choices]}
              liveEnabled={proposal.status === 'voting'}
            />
          </section>
        )}

        {/* 議論 F14 */}
        <CommentSection
          proposalId={id}
          proposerId={proposal.proposer_id}
          isLoggedIn={!!user}
          myUserId={user?.id ?? null}
          myVoteChoice={myVote && !myVote.retracted_at ? myVote.choice : null}
          comments={comments}
        />
      </article>
    </div>
  )
}

