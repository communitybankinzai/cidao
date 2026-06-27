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

// 掲載者区分（5区分）— UIで使う表示用の論理キー。
// 物理的には freefree_posts.poster_type (enum: 'member' | 'org' | 'individual_business') と
// organizations.type (enum: 'civic_group' | 'business' | 'government') の組合せで一意に決まる。
export type FreefreePosterKind =
  | 'member'              // 個人として
  | 'individual_business' // 個人事業として
  | 'civic_group'         // 団体として（市民活動団体）
  | 'business'            // 企業として
  | 'government'          // 行政として

export const FREEFREE_POSTER_KINDS: { key: FreefreePosterKind; label: string; badge: string; needsOrg: boolean; badgeClass: string }[] = [
  { key: 'member',              label: '👤 個人として',     badge: '👤 個人',     needsOrg: false, badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { key: 'individual_business', label: '🛍 個人事業として', badge: '🛍 個人事業', needsOrg: false, badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  { key: 'civic_group',         label: '👥 団体として',     badge: '👥 団体',     needsOrg: true,  badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { key: 'business',            label: '🏢 企業として',     badge: '🏢 企業',     needsOrg: true,  badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  { key: 'government',          label: '🏛 行政として',     badge: '🏛 行政',     needsOrg: true,  badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
]

export function freefreePosterKindMeta(kind: string) {
  return FREEFREE_POSTER_KINDS.find((k) => k.key === kind) ?? FREEFREE_POSTER_KINDS[0]
}

// DB側のレコード (poster_type, org.type or NULL) から論理区分を導出。
export function resolveFreefreePosterKind(
  posterType: 'member' | 'org' | 'individual_business',
  orgType: 'civic_group' | 'business' | 'government' | null | undefined,
): FreefreePosterKind {
  if (posterType === 'member') return 'member'
  if (posterType === 'individual_business') return 'individual_business'
  if (posterType === 'org' && orgType) return orgType
  return 'member'
}
