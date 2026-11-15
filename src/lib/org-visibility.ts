// 団体の公開・非公開の判定（依存なし。サーバー・クライアント・テストのどこからでも読める）
//
// public_flag = false には2つの意味がある：
//   ・申告中   … 会員が登録したばかりで、運営の承認を待っている新しい団体
//   ・運営が非公開 … 団体からの申し出などで、運営が画面から外した団体（hidden_by_admin = true）
// 申告中の団体向けの自動の動き（承認で公開・却下で削除）を、運営が非公開にした団体に働かせない。

export type OrgVisibilityState = {
  public_flag: boolean
  hidden_by_admin?: boolean | null
}

export type OrgVisibilityKind = 'public' | 'pending' | 'hidden'

export const HIDDEN_REASON_MAX = 200

/** 公開中／申告中（承認待ち）／運営が非公開、のどれか */
export function orgVisibilityKind(org: OrgVisibilityState): OrgVisibilityKind {
  if (org.public_flag) return 'public'
  return org.hidden_by_admin ? 'hidden' : 'pending'
}

/** 代表者の所属申告を承認したとき、団体を自動で公開してよいか（申告中の新しい団体だけ） */
export function shouldPublishOnApprove(org: OrgVisibilityState): boolean {
  return orgVisibilityKind(org) === 'pending'
}

/** 所属申告を却下したとき、団体ごと削除してよいか（申告中で、承認済みの会員がいないときだけ） */
export function shouldDeleteOnReject(org: OrgVisibilityState, confirmedMemberCount: number): boolean {
  return orgVisibilityKind(org) === 'pending' && confirmedMemberCount === 0
}

export type OrgVisibilityUpdate = {
  public_flag: boolean
  hidden_by_admin: boolean
  hidden_reason: string
  hidden_at: string | null
}

/**
 * 運営が公開・非公開を切り替えるときに書く値。
 * 非公開にするときは理由が要る（後から「なぜ外したか」が分からなくなるのを防ぐ）。
 */
export function buildVisibilityUpdate(
  makePublic: boolean,
  reason: string,
  now: Date = new Date(),
): { ok: true; update: OrgVisibilityUpdate } | { ok: false; error: string } {
  if (makePublic) {
    return { ok: true, update: { public_flag: true, hidden_by_admin: false, hidden_reason: '', hidden_at: null } }
  }
  const text = reason.trim()
  if (!text) return { ok: false, error: '非公開にする理由を入れてください' }
  if (text.length > HIDDEN_REASON_MAX) return { ok: false, error: `理由は${HIDDEN_REASON_MAX}字までにしてください` }
  return {
    ok: true,
    update: { public_flag: false, hidden_by_admin: true, hidden_reason: text, hidden_at: now.toISOString() },
  }
}
