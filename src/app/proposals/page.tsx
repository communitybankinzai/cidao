import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { VOTE_CHOICES } from '@/lib/categories'
import { ProposalsBrowser, type ProposalSummary } from './_components/ProposalsBrowser'

type AggRow = {
  proposal_id: string
  tier: string
  choice: string
  count: number
  weight_total: number | string
}

function snapshotFor(aggs: AggRow[]): ProposalSummary['snapshot'] {
  const totalVotes = aggs.reduce((s, a) => s + (a.count ?? 0), 0)
  // 旧選択肢（保留・協力できる等）の票も分母には含める
  const totalWeight = aggs.reduce((s, a) => s + Number(a.weight_total ?? 0), 0)
  if (totalWeight === 0) {
    return { pcts: null, totalVotes }
  }
  const pcts: Record<string, number> = {}
  for (const c of VOTE_CHOICES) {
    const w = aggs
      .filter((a) => a.choice === c.key)
      .reduce((s, a) => s + Number(a.weight_total ?? 0), 0)
    pcts[c.key] = (w / totalWeight) * 100
  }
  return { pcts, totalVotes }
}

export default async function ProposalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, title, category, binding_type, budget_size, status, discussion_start_at, voting_start_at, voting_end_at, created_at')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(100)

  const proposalIds = (proposals ?? []).map((p) => p.id)
  const { data: aggregates } = proposalIds.length > 0
    ? await supabase
        .from('vote_aggregates')
        .select('proposal_id, tier, choice, count, weight_total')
        .in('proposal_id', proposalIds)
    : { data: [] as AggRow[] }

  const aggsByProposal = new Map<string, AggRow[]>()
  for (const a of (aggregates ?? []) as AggRow[]) {
    const list = aggsByProposal.get(a.proposal_id) ?? []
    list.push(a)
    aggsByProposal.set(a.proposal_id, list)
  }

  const summaries: ProposalSummary[] = (proposals ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    binding_type: p.binding_type,
    budget_size: p.budget_size,
    status: p.status,
    discussion_start_at: p.discussion_start_at,
    voting_start_at: p.voting_start_at,
    voting_end_at: p.voting_end_at,
    created_at: p.created_at,
    snapshot: snapshotFor(aggsByProposal.get(p.id) ?? []),
  }))

  return (
    <PageShell feature="proposals" width="default">
      <PageHeader feature="proposals"
        title="提案一覧"
        description={<>市民から寄せられた {summaries.length} 件の提案</>}
        actions={
          user ? (
            <Link href="/proposals/new">
              <Button>新しい提案</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline">ログインして提案する</Button>
            </Link>
          )
        }
      />

      <ProposalsBrowser proposals={summaries} isLoggedIn={!!user} />

    </PageShell>
  )
}
