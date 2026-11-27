// 表示名（プロフィール）の確認がまだの会員かどうかの判定。
// 2026-11-28 に、仮登録（tier=light）と本登録の区別をやめた（事業主決定）。登録した時点で全部使える。
// ただし LINE の名前がそのまま表示名に入るので、本名が気づかないまま公開の場に出ないよう、
// 確認がまだの人はログイン直後に確認の画面（/me/edit?welcome=1）へ案内する。
// 確認を済ませたかどうかは members.profile_confirmed_at で見る（プロフィールを初めて保存した時に入る）。
export function needsProfileSetup(member: {
  profile_confirmed_at: string | null | undefined
}): boolean {
  return !member.profile_confirmed_at
}
