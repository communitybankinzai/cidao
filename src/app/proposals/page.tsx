import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { bindingMeta } from '@/lib/categories'
import { ProposalsBrowser, type ProposalSummary } from './_components/ProposalsBrowser'

type AggRow = {
  proposal_id: string
  tier: string
  choice: string
  count: number
  weight_total: number | string
}

function snapshotFor(bindingType: string, aggs: AggRow[]): ProposalSummary['snapshot'] {
  const meta = bindingMeta(bindingType)
  if (!meta) return { yesPct: null, noPct: null, holdPct: null, totalVotes: 0 }
  const [yesC, noC, holdC] = meta.choices
  const totalVotes = aggs.reduce((s, a) => s + (a.count ?? 0), 0)
  const totalWeight = aggs.reduce((s, a) => s + Number(a.weight_total ?? 0), 0)
  if (totalWeight === 0) {
    return { yesPct: null, noPct: null, holdPct: null, totalVotes }
  }
  const pctFor = (choice: string) => {
    const w = aggs.filter((a) => a.choice === choice).reduce((s, a) => s + Number(a.weight_total ?? 0), 0)
    return (w / totalWeight) * 100
  }
  return {
    yesPct: pctFor(yesC),
    noPct: pctFor(noC),
    holdPct: pctFor(holdC),
    totalVotes,
  }
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
    snapshot: snapshotFor(p.binding_type, aggsByProposal.get(p.id) ?? []),
  }))

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">提案一覧</h1>
            <p className="text-xs text-slate-500 mt-1">市民から寄せられた {summaries.length} 件の提案</p>
          </div>
          {user ? (
            <Link href="/proposals/new">
              <Button>新しい提案</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline">ログインして提案する</Button>
            </Link>
          )}
        </header>

        <ProposalsBrowser proposals={summaries} isLoggedIn={!!user} />

        <p className="text-xs text-slate-400 text-center pt-4">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </p>
      </div>
    </div>
  )
}
