import { Bot, Building2, CalendarDays, CircleHelp, Megaphone, Trophy, UserRound, Users, Vote, type LucideIcon } from 'lucide-react'
import type { TileColor } from '@/components/Tile'

/**
 * CiDAO の「できること」ごとの名前・アイコン・色。
 * ホームのタイルと、各ページの見出し（PageHeader）が同じ色・同じアイコンを使うことで、
 * 「ホームで押したものと同じ色のページが開いた」と分かるようにする（2026-10-19 事業主の希望）。
 */
export const FEATURES = {
  proposals: { label: '提案・投票', color: 'indigo', icon: Vote },
  events: { label: 'イベント', color: 'orange', icon: CalendarDays },
  orgs: { label: '団体をさがす', color: 'emerald', icon: Building2 },
  talent: { label: 'メンバー', color: 'violet', icon: Users },
  freefree: { label: '掲示板', color: 'amber', icon: Megaphone },
  ranking: { label: 'ランキング', color: 'rose', icon: Trophy },
  match: { label: 'AIに相談', color: 'cyan', icon: Bot },
  help: { label: '使い方', color: 'sky', icon: CircleHelp },
  account: { label: 'マイページ', color: 'navy', icon: UserRound },
} as const satisfies Record<string, { label: string; color: TileColor; icon: LucideIcon }>

export type FeatureKey = keyof typeof FEATURES

/**
 * ページ見出しの色（アイコンのチップ・小見出し）。
 * 文字は白い背景で4.5:1以上になる濃さ（700番台）。Tailwind が拾えるよう、クラス名は丸ごと書く
 */
export const HEADER_COLORS: Record<TileColor, { chip: string; eyebrow: string }> = {
  indigo: { chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200', eyebrow: 'text-indigo-700 dark:text-indigo-300' },
  orange: { chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200', eyebrow: 'text-orange-700 dark:text-orange-300' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200', eyebrow: 'text-emerald-700 dark:text-emerald-300' },
  violet: { chip: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200', eyebrow: 'text-violet-700 dark:text-violet-300' },
  amber: { chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200', eyebrow: 'text-amber-700 dark:text-amber-300' },
  rose: { chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200', eyebrow: 'text-rose-700 dark:text-rose-300' },
  cyan: { chip: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-200', eyebrow: 'text-cyan-700 dark:text-cyan-300' },
  sky: { chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200', eyebrow: 'text-sky-700 dark:text-sky-300' },
  navy: { chip: 'bg-slate-200 text-[#1e3a5f] dark:bg-slate-700 dark:text-sky-200', eyebrow: 'text-[#1e3a5f] dark:text-sky-300' },
}

/** 画面全体の「機能の色」のクラス（globals.css の .accent-*）。ページの外側の枠に付ける */
export function accentClass(feature: FeatureKey): string {
  return `accent-${FEATURES[feature].color}`
}
