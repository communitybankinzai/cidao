// 本登録（プロフィール完成）がまだの会員かどうかの判定。
// 興味分野は任意になった（2026-11-06）ため、「興味分野が空＝本登録まだ」とは言えない。
// 本登録を終えた人（tier が light 以外）は、興味分野が空でも対象にしない。
// 仮登録（tier=light）のまま興味分野も未選択の人だけを、ログイン直後に本登録画面へ案内する。
export function needsProfileSetup(member: {
  tier: string | null | undefined
  interests: string[] | null | undefined
}): boolean {
  return member.tier === 'light' && (member.interests ?? []).length === 0
}
