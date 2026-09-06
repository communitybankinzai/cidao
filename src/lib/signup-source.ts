// 会員の登録経路（signup_source）の受け渡し。
// /login に utm 付きで来た人（例：印西市３次元MAPの受付画面に出す登録QR）を、初回ログインで members.signup_source に残す。
// 値は "utm_source:utm_medium:utm_campaign" の形（英数字・-_ のみ、各20文字まで）。既存会員のログインでは書かない（auth/callback 側で判定）。
export const SIGNUP_SOURCE_COOKIE = 'cidao_signup_src'
export const SIGNUP_SOURCE_MAX_AGE = 24 * 60 * 60 // 秒。QR を読んでから登録完了までの猶予

const PART = /^[A-Za-z0-9_-]{1,20}$/

export function buildSignupSource(source: string | null, medium: string | null, campaign: string | null): string | null {
  if (!source || !PART.test(source)) return null
  const parts = [source]
  if (medium && PART.test(medium)) parts.push(medium)
  if (campaign && PART.test(campaign)) parts.push(campaign)
  return parts.join(':')
}

export function isValidSignupSource(value: string | null | undefined): value is string {
  if (!value || value.length > 60) return false
  return value.split(':').every((p) => PART.test(p))
}

// 管理画面での表示名
export const SIGNUP_SOURCE_LABEL: Record<string, string> = {
  'metaverse:reception:entry': '３次元MAP 受付画面の登録QR',
  'metaverse:auth:line': '３次元MAP 受付の LINE ボタン',
}
