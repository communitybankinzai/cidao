// FreeFree 掲載カテゴリ（仕様§3.10.1）
export const FREEFREE_CATEGORIES = [
  { key: 'food',      label: '🍰 食' },
  { key: 'retail',    label: '🛍 物販' },
  { key: 'education', label: '🎓 教育' },
  { key: 'craft',     label: '🛠 手仕事' },
  { key: 'living',    label: '🏠 暮らし' },
  { key: 'startup',   label: '💼 起業' },
  { key: 'event',     label: '🌟 イベント' },
  { key: 'volunteer', label: '🤝 ボランティア' },
] as const

export function freefreeCategoryLabel(key: string): string {
  return FREEFREE_CATEGORIES.find((c) => c.key === key)?.label ?? key
}

export const FREEFREE_PERIODS = [
  { key: 'p_1week',   label: '1週間' },
  { key: 'p_1month',  label: '1ヶ月' },
  { key: 'p_3months', label: '3ヶ月' },
] as const

export function periodToDays(key: string): number {
  switch (key) {
    case 'p_1week': return 7
    case 'p_1month': return 30
    case 'p_3months': return 90
    default: return 30
  }
}
