// 団体の「公式SNSで紹介してよいか」の判定（依存なし。画面・サーバー・テストから読める）。
//
// organizations.sns_share
//   true  … 団体（登録した会員）が紹介を希望した
//   false … 団体が紹介を希望しない → 下書きを作らない
//   null  … 団体に聞いていない（運営が公開情報から登録した団体・この欄ができる前の団体）

export type OrgSnsShare = boolean | null

/**
 * 登録するときに保存する値。
 * 運営が、代表者としてではなく登録した団体は「団体に聞いていない」（null）。
 * 運営がチェックを入れても、それは団体の意思ではないので true にしない。
 */
export function orgSnsShareOnCreate(input: { isAdmin: boolean; asRepresentative: boolean; checked: boolean }): OrgSnsShare {
  if (input.isAdmin && !input.asRepresentative) return null
  return input.checked
}

/** 紹介の下書きを作ってよいか。団体が「希望しない」と答えたときだけ作らない */
export function shouldAnnounceOrg(snsShare: OrgSnsShare | undefined): boolean {
  return snsShare !== false
}

/** 運営の承認画面の下書きに出す一言。承認する人が「団体が望んだ紹介か」を見分けるため */
export function orgSnsShareNote(snsShare: OrgSnsShare | undefined): { text: string; tone: 'ok' | 'warn' } {
  if (snsShare === true) return { text: '団体が紹介を希望', tone: 'ok' }
  if (snsShare === false) return { text: '団体は紹介を希望していません', tone: 'warn' }
  return { text: '団体の依頼ではありません（団体に未確認）', tone: 'warn' }
}
