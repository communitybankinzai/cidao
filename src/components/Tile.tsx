import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

/**
 * ホームなどに並べる「アイコン付きの大きなタイル」。
 *
 * 初めて使う人が、文章を読まずに「何ができるか」を絵と短い言葉で選べるようにする。
 * 1画面に並べるのは9個まで、ラベルは5〜6文字までを目安にする。
 *
 * - アイコンは lucide-react（ISC ライセンス）。他社アプリの絵はそのまま使わない
 * - prefetch={false}：タイルは常に画面内にあるため、既定の先読みだと開くたびに
 *   裏でサーバー呼び出しが増える（Vercel の無料枠が上限に近いので控える）
 * - 色は意味づけでなく見分けやすさのため（2026-10-19 事業主が「9色・淡い背景」を選択）。
 *   ラベルは必ず濃い色の文字で、色だけで区別させない。ログイン／マイページは濃い紺で目立たせる。
 *   Tailwind が拾えるよう、クラス名は丸ごと書く
 */
export function TileGrid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className="grid grid-cols-3 gap-2.5 sm:gap-3">{children}</ul>
    </nav>
  )
}

type Color = { box: string; icon: string; label: string }

const SOFT_LABEL = 'text-slate-800 dark:text-slate-100'

/** 淡い背景＋色つきアイコン */
const COLORS = {
  indigo: {
    box: 'border-indigo-100 bg-indigo-50 hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950 dark:hover:bg-indigo-900',
    icon: 'text-indigo-600 dark:text-indigo-300',
    label: SOFT_LABEL,
  },
  orange: {
    box: 'border-orange-100 bg-orange-50 hover:border-orange-300 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950 dark:hover:bg-orange-900',
    icon: 'text-orange-600 dark:text-orange-300',
    label: SOFT_LABEL,
  },
  emerald: {
    box: 'border-emerald-100 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:hover:bg-emerald-900',
    icon: 'text-emerald-600 dark:text-emerald-300',
    label: SOFT_LABEL,
  },
  violet: {
    box: 'border-violet-100 bg-violet-50 hover:border-violet-300 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950 dark:hover:bg-violet-900',
    icon: 'text-violet-600 dark:text-violet-300',
    label: SOFT_LABEL,
  },
  amber: {
    box: 'border-amber-100 bg-amber-50 hover:border-amber-300 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:hover:bg-amber-900',
    icon: 'text-amber-600 dark:text-amber-300',
    label: SOFT_LABEL,
  },
  rose: {
    box: 'border-rose-100 bg-rose-50 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950 dark:hover:bg-rose-900',
    icon: 'text-rose-600 dark:text-rose-300',
    label: SOFT_LABEL,
  },
  cyan: {
    box: 'border-cyan-100 bg-cyan-50 hover:border-cyan-300 hover:bg-cyan-100 dark:border-cyan-900 dark:bg-cyan-950 dark:hover:bg-cyan-900',
    icon: 'text-cyan-700 dark:text-cyan-300',
    label: SOFT_LABEL,
  },
  sky: {
    box: 'border-sky-100 bg-sky-50 hover:border-sky-300 hover:bg-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-600 dark:hover:bg-slate-800',
    icon: 'text-sky-700 dark:text-sky-300',
    label: SOFT_LABEL,
  },
  navy: {
    box: 'border-[#1e3a5f] bg-[#1e3a5f] hover:bg-[#2a4d7a] dark:border-sky-700 dark:bg-sky-800 dark:hover:bg-sky-700',
    icon: 'text-white',
    label: 'text-white',
  },
} satisfies Record<string, Color>

export type TileColor = keyof typeof COLORS

export function Tile({
  href,
  icon: Icon,
  label,
  color = 'sky',
}: {
  href: string
  icon: LucideIcon
  label: string
  /** タイルの色。省略時は従来の淡い青 */
  color?: TileColor
}) {
  const c = COLORS[color]
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={`flex h-full min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border px-1 py-3 text-center transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${c.box}`}
      >
        <Icon aria-hidden className={`size-7 ${c.icon}`} strokeWidth={1.75} />
        <span className={`text-[13px] font-semibold leading-tight ${c.label}`}>{label}</span>
      </Link>
    </li>
  )
}
