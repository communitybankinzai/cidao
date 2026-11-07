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

// SNS 告知リンク（sns-template.ts の withUtm）由来の経路の表示名：媒体と告知の種類に分けて読める形にする
const MEDIUM_NAME: Record<string, string> = {
  threads: 'Threads', 'threads-profile': 'Threads（プロフィール）', instagram: 'Instagram', facebook: 'Facebook', line: 'LINE', x: 'X', sns: 'SNS',
}
const CAMPAIGN_NAME: Record<string, string> = {
  freefree_announce: 'FreeFree の告知', freefree_board: 'FreeFree 掲示板トップ', freefree_forshops: 'お店の方へ',
  event_announce: 'イベントの告知', org_announce: '団体の紹介', proposal_announce: '提案の告知', daily_events: '毎朝のイベントまとめ',
}

export function signupSourceLabel(value: string | null | undefined): string {
  if (!value) return '（記録なし）'
  const fixed = SIGNUP_SOURCE_LABEL[value]
  if (fixed) return fixed
  // 形は「媒体:告知の種類」（utm_medium を付けない現在の形）か「媒体:social:告知の種類」（提案告知の旧形）
  const [source, ...rest] = value.split(':')
  const m = MEDIUM_NAME[source]
  if (!m) return value
  const campaign = rest.filter((p) => p !== 'social').pop()
  return `${m} の ${CAMPAIGN_NAME[campaign ?? ''] ?? (campaign ?? '告知リンク')}`
}
