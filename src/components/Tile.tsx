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
 */
export function TileGrid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className="grid grid-cols-3 gap-2.5 sm:gap-3">{children}</ul>
    </nav>
  )
}

export function Tile({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: LucideIcon
  label: string
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className="flex h-full min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-sky-100 bg-sky-50 px-1 py-3 text-center transition hover:border-sky-300 hover:bg-sky-100 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-600 dark:hover:bg-slate-800"
      >
        <Icon aria-hidden className="size-7 text-[#1e3a5f] dark:text-sky-300" strokeWidth={1.75} />
        <span className="text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-100">
          {label}
        </span>
      </Link>
    </li>
  )
}
