// 貢献度ポイント集計と達成バッジ判定（仕様§3.4）

export type ContributionRow = {
  action_type: string
  pt: number
  created_at: string
}

export type ContributionSummary = {
  total: number
  byAction: Record<string, { count: number; pt: number }>
  monthlyTotal: number  // 当月
}

export function summarize(rows: ContributionRow[]): ContributionSummary {
  const total = rows.reduce((s, r) => s + r.pt, 0)
  const byAction: Record<string, { count: number; pt: number }> = {}
  for (const r of rows) {
    byAction[r.action_type] ??= { count: 0, pt: 0 }
    byAction[r.action_type].count += 1
    byAction[r.action_type].pt += r.pt
  }
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const monthlyTotal = rows
    .filter((r) => new Date(r.created_at).getTime() >= monthStart)
    .reduce((s, r) => s + r.pt, 0)
  return { total, byAction, monthlyTotal }
}

export const ACTION_LABELS: Record<string, string> = {
  proposal_posted:      '提案投稿',
  proposal_passed:      '提案可決ボーナス',
  voted_binding:        '投票（拘束）',
  voted_advisory:       '投票（諮問）',
  question_posted:      '質問投稿',
  question_answered:    '質問回答',
  comment_posted:       'コメント投稿',
  event_hosted:         'イベント主催',
  event_attended:       'イベント参加',
  event_staff:          'イベントスタッフ',
  freefree_posted:      'FreeFree 掲載',
  freefree_coupon_used: 'クーポン利用',
  freefree_support:     '応援',
  profile_filled:       'プロフィール充実',
  login_streak:         '連続ログイン',
}

export type Badge = { key: string; label: string; achieved: boolean; hint?: string }

export function evaluateBadges(rows: ContributionRow[], total: number): Badge[] {
  const byAction = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.action_type] = (acc[r.action_type] ?? 0) + 1
    return acc
  }, {})

  return [
    { key: 'first_proposal',  label: '初投稿',         achieved: (byAction.proposal_posted ?? 0) >= 1,  hint: '提案を1件投稿' },
    { key: 'voter_10',        label: '10回投票',       achieved: ((byAction.voted_binding ?? 0) + (byAction.voted_advisory ?? 0)) >= 10, hint: '投票10回' },
    { key: 'proposer_10',     label: '提案10件',       achieved: (byAction.proposal_posted ?? 0) >= 10, hint: '提案10件投稿' },
    { key: 'first_passed',    label: '初可決',         achieved: (byAction.proposal_passed ?? 0) >= 1,  hint: '提案が1件可決' },
    { key: 'commenter_50',    label: 'コメント50件',   achieved: (byAction.comment_posted ?? 0) >= 50,  hint: 'コメント50件' },
    { key: 'master_1000',     label: 'マスター',       achieved: total >= 1000,                          hint: '累計1000pt' },
    { key: 'legend_5000',     label: 'レジェンド',     achieved: total >= 5000,                          hint: '累計5000pt' },
  ]
}
