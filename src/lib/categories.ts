// 印西市の市民活動分野（仕様§3.2.1 で AI 自動分類されるが Phase 1 は手動選択）
// AI 連携時はこのキーを出力カテゴリの ENUM として使う
export const PROPOSAL_CATEGORIES = [
  { key: 'machizukuri',    label: 'まちづくり・地域活性化' },
  { key: 'kodomo',         label: '子ども・教育・若者支援' },
  { key: 'fukushi',        label: '健康・福祉・医療' },
  { key: 'kankyo',         label: '環境・自然・里山' },
  { key: 'bunka',          label: '文化・芸術・スポーツ' },
  { key: 'bosai',          label: '災害・防災・防犯' },
  { key: 'tabunka',        label: '多文化共生・人権' },
  { key: 'sangyo',         label: '経済・産業・しごと' },
  { key: 'gyosei',         label: '市政・行政連携' },
  { key: 'other',          label: 'その他' },
] as const

export type ProposalCategoryKey = typeof PROPOSAL_CATEGORIES[number]['key']

export function categoryLabel(key: string): string {
  return PROPOSAL_CATEGORIES.find((c) => c.key === key)?.label ?? key
}

export const BUDGET_SIZES = [
  { key: 'small',  label: '小（〜5万円）' },
  { key: 'medium', label: '中（5〜50万円）' },
  { key: 'large',  label: '大（50万円〜）' },
] as const

export type BudgetSizeKey = typeof BUDGET_SIZES[number]['key']

export function budgetLabel(key: string): string {
  return BUDGET_SIZES.find((b) => b.key === key)?.label ?? key
}

// ===========================
// 投票の選択肢（2026-07-29 より全提案種別で共通の4択）
// key は votes.choice / vote_aggregates.choice に保存される値そのもの。
// side は拘束的決議の可決判定（finalize_voting）での賛否の振り分け。
// 'neutral'（保留）は賛否のどちらにも数えず、定足数の分母にだけ算入する。
// ===========================
export const VOTE_CHOICES = [
  { key: '大賛成', desc: '是非協力したい',   side: 'yes',     color: 'bg-emerald-600' },
  { key: '賛成',   desc: 'でも協力は難しい', side: 'yes',     color: 'bg-emerald-400' },
  { key: '保留',   desc: 'もっと知りたい',   side: 'neutral', color: 'bg-slate-400' },
  { key: '反対',   desc: '良いと思わない',   side: 'no',      color: 'bg-rose-500' },
] as const

// 「是非協力したい」票。提案者へ名乗り出て連絡できる唯一の選択肢
export const STRONG_SUPPORT_CHOICE = '大賛成'

// 判断がつかない票。提案者への質問動線を強調する（仕様§3.3.4）
export const NEUTRAL_CHOICE = '保留'

export type VoteChoiceKey = typeof VOTE_CHOICES[number]['key']

export const VOTE_CHOICE_KEYS: readonly string[] = VOTE_CHOICES.map((c) => c.key)

export function voteChoiceMeta(key: string) {
  return VOTE_CHOICES.find((c) => c.key === key)
}

export const BINDING_TYPES = [
  {
    key: 'internal',
    label: 'CBI 内部事項（拘束的）',
    desc: '年会費・運営方針など。大賛成/賛成/保留/反対 で投票',
    choices: VOTE_CHOICE_KEYS,
  },
  {
    key: 'hosted',
    label: 'CBI 主催事業（拘束的）',
    desc: '企画採用・予算配分など。大賛成/賛成/保留/反対 で投票',
    choices: VOTE_CHOICE_KEYS,
  },
  {
    key: 'external',
    label: '外部・市政提案（諮問的）',
    desc: '市への要望・他事業提案。大賛成/賛成/保留/反対 で意向把握',
    choices: VOTE_CHOICE_KEYS,
  },
] as const

export type BindingTypeKey = typeof BINDING_TYPES[number]['key']

export function bindingMeta(key: string) {
  return BINDING_TYPES.find((b) => b.key === key)
}

// ===========================
// 投票締切のデフォルト＝投票開始が属する四半期の末日 23:59:59（JST）
// DB 側の public.quarter_end_at() と同じ規則。UI の案内表示に使う。
// ===========================
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export function quarterEndAt(from: Date = new Date()): Date {
  const jst = new Date(from.getTime() + JST_OFFSET_MS)
  const nextQuarterMonth = Math.floor(jst.getUTCMonth() / 3) * 3 + 3  // 12 なら翌年1月に繰り上がる
  const nextQuarterStartUtc = Date.UTC(jst.getUTCFullYear(), nextQuarterMonth, 1)
  return new Date(nextQuarterStartUtc - JST_OFFSET_MS - 1000)
}

export function formatJstDate(d: Date): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS)
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`
}
