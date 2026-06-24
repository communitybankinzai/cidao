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
  { key: 'small',  label: '小（〜5万円）',       votingDays: 3 },
  { key: 'medium', label: '中（5〜50万円）',     votingDays: 7 },
  { key: 'large',  label: '大（50万円〜）',      votingDays: 14 },
] as const

export type BudgetSizeKey = typeof BUDGET_SIZES[number]['key']

export function budgetLabel(key: string): string {
  return BUDGET_SIZES.find((b) => b.key === key)?.label ?? key
}

export function votingDaysFor(budget: string): number {
  return BUDGET_SIZES.find((b) => b.key === budget)?.votingDays ?? 7
}

export const BINDING_TYPES = [
  {
    key: 'internal',
    label: 'CBI 内部事項（拘束的）',
    desc: '年会費・運営方針など。賛成/反対/保留で投票',
    choices: ['賛成', '反対', '保留'],
  },
  {
    key: 'hosted',
    label: 'CBI 主催事業（拘束的）',
    desc: '企画採用・予算配分など。賛成/反対/保留で投票',
    choices: ['賛成', '反対', '保留'],
  },
  {
    key: 'external',
    label: '外部・市政提案（諮問的）',
    desc: '市への要望・他事業提案。協力できる/難しい/わからない で意向把握',
    choices: ['協力できる', '難しい', 'わからない'],
  },
] as const

export type BindingTypeKey = typeof BINDING_TYPES[number]['key']

export function bindingMeta(key: string) {
  return BINDING_TYPES.find((b) => b.key === key)
}
