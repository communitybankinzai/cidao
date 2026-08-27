// 電子決裁（CBI 役員の内部決裁）の共通ロジック。
//
// 決裁の可否判定はここに集約する。定足数・可決要件・期限などの数値は
// approval_rules テーブル（決裁規程のデータ化）から受け取り、コードには持たない。
// 根拠: docs/2026-08-25_決裁規程_内規_案v1.md ／
//       cidao/proposals/2026-08-25_電子決裁システムの設計方針.md
//
// このファイルは純粋なロジックのみ（Node API・Supabase 依存なし）。
// Server Component / Server Actions から使う。クライアントには
// 計算済みの結果（シリアライズ可能な値）だけを渡すこと。

// 添付ファイルの非公開バケット（公開バケットの画像保存とは別。署名付きURLで閲覧）
export const ATTACHMENT_BUCKET = 'approval-attachments'

export type OfficerRole = 'chair' | 'vice_chair' | 'treasurer' | 'auditor'
export type ApprovalCategory = 'project' | 'expense' | 'document' | 'conflict_of_interest'
export type RequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn'
export type StampAction = 'approve' | 'reject' | 'hold' | 'revoke'

export const ROLE_LABEL: Record<OfficerRole, string> = {
  chair: '会長',
  vice_chair: '副会長',
  treasurer: '会計',
  auditor: '監査役',
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: '下書き',
  pending: '決裁中',
  approved: '承認',
  rejected: '却下',
  withdrawn: '取り下げ',
}

export const ACTION_LABEL: Record<StampAction, string> = {
  approve: '承認',
  reject: '却下',
  hold: '保留',
  revoke: '押印取消',
}

export type Officer = {
  id: string
  display_name: string
  officer_role: OfficerRole
}

export type ApprovalRule = {
  id: string
  category: ApprovalCategory
  label: string
  description: string | null
  required_roles: string[]
  substitute_roles: string[]
  exclude_involved: boolean
  quorum: number
  pass_fraction: number
  threshold_amount: number | null
  deadline_days: number
  version: number
  valid_from: string
  valid_to: string | null
}

export type ApprovalRequest = {
  id: string
  title: string
  category: ApprovalCategory
  body: string
  amount: number | null
  requested_by: string
  status: RequestStatus
  body_hash: string
  conflict_officer_ids: string[]
  conflict_note: string | null
  attachments: { path: string; name: string; size: number }[]
  created_at: string
  decided_at: string | null
}

export type ApprovalStamp = {
  id: string
  request_id: string
  member_id: string
  officer_role: OfficerRole
  action: StampAction
  comment: string | null
  body_hash: string
  stamped_at: string
}

// 案件の作成時点で有効だった版の決裁基準を選ぶ
// （基準を変えても過去の決裁の判定根拠が残るようにするため）
export function pickRule(
  rules: ApprovalRule[],
  category: ApprovalCategory,
  atIso: string
): ApprovalRule | null {
  const at = new Date(atIso).getTime()
  const candidates = rules.filter((r) => {
    if (r.category !== category) return false
    if (new Date(r.valid_from).getTime() > at) return false
    if (r.valid_to !== null && new Date(r.valid_to).getTime() <= at) return false
    return true
  })
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (a.version >= b.version ? a : b))
}

// 役員1名ぶんの「現在の意思表示」。
// スタンプは追記のみなので、その役員の最新レコードで判定する:
//   - 最新が revoke → 意思表示なし（押し直し待ち）
//   - 最新の body_hash が案件の現在の body_hash と不一致 → 本文変更前の押印。
//     無効（stale）として表示はするが、決裁の集計には数えない
export type MemberIntent = {
  memberId: string
  stamp: ApprovalStamp | null // 最新の有効な意思表示（revoke 後・無効分は null）
  staleStamp: ApprovalStamp | null // 本文変更で無効になった押印（表示用）
}

export function latestIntents(request: ApprovalRequest, stamps: ApprovalStamp[]): Map<string, MemberIntent> {
  const byMember = new Map<string, ApprovalStamp[]>()
  for (const s of stamps) {
    if (s.request_id !== request.id) continue
    const list = byMember.get(s.member_id) ?? []
    list.push(s)
    byMember.set(s.member_id, list)
  }
  const result = new Map<string, MemberIntent>()
  for (const [memberId, list] of byMember) {
    list.sort((a, b) => new Date(a.stamped_at).getTime() - new Date(b.stamped_at).getTime())
    const latest = list[list.length - 1]
    if (latest.action === 'revoke') {
      result.set(memberId, { memberId, stamp: null, staleStamp: null })
    } else if (latest.body_hash !== request.body_hash) {
      result.set(memberId, { memberId, stamp: null, staleStamp: latest })
    } else {
      result.set(memberId, { memberId, stamp: latest, staleStamp: null })
    }
  }
  return result
}

export type ApprovalEvaluation = {
  rule: ApprovalRule
  // 利益相反の当事者（起案者＋指定役員）。押印不可・定足数の母数からも除外
  excludedIds: string[]
  // 意思表示できる役員（監査役と当事者を除く）
  stampableOfficers: Officer[]
  // 承認が必須の役員（決裁権者。起案者・当事者は代理役職に置き換え）
  requiredApprovers: Officer[]
  // 決裁権者を確保できない（該当役員がいない・全員が当事者）場合 true
  requiredUnresolvable: boolean
  intents: Map<string, MemberIntent>
  expressedCount: number
  approveCount: number
  rejectCount: number
  holdCount: number
  quorumBase: number
  quorumMet: boolean
  passMet: boolean
  outcome: 'approved' | 'rejected' | 'pending'
  deadlineAt: string
  overdue: boolean
}

// 決裁の現在状態を判定する。
//   可決 = 定足数を満たし、意思表示の過半数が承認し、かつ決裁権者全員が承認
//   却下 = 決裁権者のいずれかが却下（決裁規程 第3条の決裁権者の判断を優先）
//   それ以外 = 決裁中のまま（期限超過してもみなし承認はしない: 第7条第2項）
export function evaluateRequest(
  request: ApprovalRequest,
  rule: ApprovalRule,
  officers: Officer[],
  stamps: ApprovalStamp[],
  now: Date = new Date()
): ApprovalEvaluation {
  const excludedIds = rule.exclude_involved
    ? Array.from(new Set([request.requested_by, ...request.conflict_officer_ids]))
    : []
  const isExcluded = (id: string) => excludedIds.includes(id)

  // 監査役は意思表示に参加しない（閲覧のみ。承認すると監査の独立性が失われる）
  const stampableOfficers = officers.filter(
    (o) => o.officer_role !== 'auditor' && !isExcluded(o.id)
  )

  // 決裁権者の解決: required_roles の担当役員。
  // - 当事者（利益相反）は決裁権者になれない
  // - 担当役員が起案者本人で、区分に substitute_roles が定義されている場合は
  //   代理役職の役員が代わる（決裁規程 第3条第1項第三号
  //   「起案者が会長である場合は副会長」）。代理が定義されていない区分では、
  //   起案者もその役職の決裁権者として自ら押印する（例: 会計が支出を起案する場合。
  //   内規は利益相反と対外文書以外で自己承認を禁じていない）
  const requiredApprovers: Officer[] = []
  let requiredUnresolvable = false
  const substitutes = officers.filter(
    (o) =>
      rule.substitute_roles.includes(o.officer_role) &&
      !isExcluded(o.id) &&
      o.id !== request.requested_by
  )
  const pushUnique = (o: Officer) => {
    if (!requiredApprovers.some((x) => x.id === o.id)) requiredApprovers.push(o)
  }
  for (const role of rule.required_roles) {
    const holder = officers.find((o) => o.officer_role === role)
    if (holder && !isExcluded(holder.id)) {
      if (holder.id === request.requested_by && substitutes.length > 0) {
        // 起案者本人 → 代理役職に置き換え
        const sub = substitutes.find((s) => !requiredApprovers.some((x) => x.id === s.id))
        if (sub) { pushUnique(sub); continue }
      }
      pushUnique(holder)
      continue
    }
    // 当事者として除外された決裁権者は、利益相反区分では単に外す
    // （当事者を除く残りの役員だけで決裁する: 決裁規程 第5条第3項）
    if (holder && isExcluded(holder.id) && rule.exclude_involved) continue
    // 担当者不在 → 代理役職で置き換え。代理もいなければ決裁権者を確保できない
    const sub = substitutes.find((s) => !requiredApprovers.some((x) => x.id === s.id))
    if (sub) pushUnique(sub)
    else requiredUnresolvable = true
  }

  const intents = latestIntents(request, stamps)
  const stampableIds = new Set(stampableOfficers.map((o) => o.id))
  let approveCount = 0
  let rejectCount = 0
  let holdCount = 0
  for (const [memberId, intent] of intents) {
    if (!stampableIds.has(memberId) || !intent.stamp) continue
    if (intent.stamp.action === 'approve') approveCount += 1
    else if (intent.stamp.action === 'reject') rejectCount += 1
    else if (intent.stamp.action === 'hold') holdCount += 1
  }
  const expressedCount = approveCount + rejectCount + holdCount

  // 定足数の母数 = 意思表示できる役員数（利益相反の当事者を除外した後の人数:
  // 決裁規程 第5条第3項。監査役は意思表示に参加しないため母数に含めない）
  const quorumBase = stampableOfficers.length
  const quorumMet = quorumBase > 0 && expressedCount > quorumBase * rule.quorum
  const passMet = expressedCount > 0 && approveCount > expressedCount * rule.pass_fraction

  const requiredAllApproved =
    requiredApprovers.length > 0 &&
    !requiredUnresolvable &&
    requiredApprovers.every((o) => intents.get(o.id)?.stamp?.action === 'approve')
  const requiredAnyRejected = requiredApprovers.some(
    (o) => intents.get(o.id)?.stamp?.action === 'reject'
  )

  let outcome: ApprovalEvaluation['outcome'] = 'pending'
  if (requiredAnyRejected) outcome = 'rejected'
  else if (quorumMet && passMet && requiredAllApproved) outcome = 'approved'

  const deadlineAt = new Date(
    new Date(request.created_at).getTime() + rule.deadline_days * 24 * 60 * 60 * 1000
  ).toISOString()
  const overdue = request.status === 'pending' && now.getTime() > new Date(deadlineAt).getTime()

  return {
    rule,
    excludedIds,
    stampableOfficers,
    requiredApprovers,
    requiredUnresolvable,
    intents,
    expressedCount,
    approveCount,
    rejectCount,
    holdCount,
    quorumBase,
    quorumMet,
    passMet,
    outcome,
    deadlineAt,
    overdue,
  }
}
