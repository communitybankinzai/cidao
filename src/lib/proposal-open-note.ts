/**
 * ホームの「提案・投票」タイルに出す1行（例：「投票中 4件」）を作る。
 * - 数えるのは、いま参加できる提案だけ（投票中・議論中）。結果が出たもの・下書きは数えない。
 * - 投票の締め切りを過ぎた行は、状態がまだ「投票中」のままでも数えない（締め切りの処理が動くまでの間）。
 * - どちらも0件のときは null（「0件」とは出さない。タイルは今までどおりの見た目）。
 * 呼び方の「投票中」「議論中」は、提案一覧（ProposalsBrowser）のタブと同じ。
 */
export type OpenProposalRow = { status: string; voting_end_at: string | null }

export function countOpenProposals(rows: readonly OpenProposalRow[], nowMs: number): { voting: number; discussion: number } {
  let voting = 0
  let discussion = 0
  for (const r of rows) {
    if (r.status === 'discussion') {
      discussion += 1
    } else if (r.status === 'voting') {
      const end = r.voting_end_at ? new Date(r.voting_end_at).getTime() : null
      if (end === null || !Number.isFinite(end) || end > nowMs) voting += 1
    }
  }
  return { voting, discussion }
}

export function openProposalsNote(rows: readonly OpenProposalRow[] | null | undefined, nowMs: number): string | null {
  const { voting, discussion } = countOpenProposals(rows ?? [], nowMs)
  const parts: string[] = []
  if (voting > 0) parts.push(`投票中 ${voting}件`)
  if (discussion > 0) parts.push(`議論中 ${discussion}件`)
  return parts.length > 0 ? parts.join('・') : null
}
