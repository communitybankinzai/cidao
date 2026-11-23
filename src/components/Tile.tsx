import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'

/**
 * ホームなどに並べる「アイコン付きの大きなタイル」。
 *
 * 初めて使う人が、文章を読まずに「何ができるか」を絵と短い言葉で選べるようにする。
 * 1画面に並べるのは10個まで、ラベルは5〜6文字までを目安にする（2026-11-23 事業主決定で「病院」を足し、9個→10個）。
 *
 * 2026-11-23（事業主決定・A案）：ホームを3段に分け、段ごとに形を変えた。
 *   上段＝横長の丸ボタン（PillLink：マイページ・使い方）
 *   中段＝角丸のタイル（Tile：CiDAO の主な機能5つ）
 *   下段＝丸いアイコン（RoundLink：「あったらいいな」を形にした実例4つ）
 * 3Dマップが増えて合計11個。動き（順番に現れる・押すと弾む・アイコンが揺れる）は globals.css の .cidao-stagger／.cidao-tile
 *
 * - アイコンは lucide-react（ISC ライセンス）。他社アプリの絵はそのまま使わない
 * - prefetch={false}：タイルは常に画面内にあるため、既定の先読みだと開くたびに
 *   裏でサーバー呼び出しが増える（Vercel の無料枠が上限に近いので控える）
 * - 色は意味づけでなく見分けやすさのため（2026-10-19 事業主が「9色・淡い背景」を選択）。
 *   ラベルは必ず濃い色の文字で、色だけで区別させない。ログイン／マイページは濃い紺で目立たせる。
 *   Tailwind が拾えるよう、クラス名は丸ごと書く
 */
export function TileGrid({
  label,
  children,
  cols = 3,
}: {
  label: string
  children: React.ReactNode
  /** 6 は「上の行に2個・下の行に3個」のように、タイルごとに幅を変えるとき（Tile の wide と組で使う） */
  cols?: 3 | 6
}) {
  return (
    <nav aria-label={label}>
      <ul className={`cidao-stagger grid gap-2.5 sm:gap-3 ${cols === 6 ? 'grid-cols-6' : 'grid-cols-3'}`}>{children}</ul>
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
  teal: {
    box: 'border-teal-100 bg-teal-50 hover:border-teal-300 hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950 dark:hover:bg-teal-900',
    icon: 'text-teal-700 dark:text-teal-300',
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
  external = false,
  span,
  seenKey,
  badge,
}: {
  href: string
  icon: LucideIcon
  label: string
  /** タイルの色。省略時は従来の淡い青 */
  color?: TileColor
  /** CiDAO の外のページ（CBI サイトの食レポマップなど）。新しいタブで開く（2026-11-13） */
  external?: boolean
  /** TileGrid の cols={6} の中での幅（3＝半分、2＝3分の1） */
  span?: 2 | 3
  /** 新着の印（NewDot）と組で使う。押すと「見た」と覚える（HomeTileEffects が制御） */
  seenKey?: string
  /** 右上に重ねる印（新着の点など） */
  badge?: React.ReactNode
}) {
  const c = COLORS[color]
  const className = `cidao-tile relative flex h-full min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border px-1 py-3 text-center transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${c.box}`
  const inner = (
    <>
      <Icon aria-hidden className={`size-7 ${c.icon}`} strokeWidth={1.75} />
      <span className={`text-[13px] font-semibold leading-tight ${c.label}`}>{label}</span>
      {badge}
    </>
  )
  return (
    <li className={span === 3 ? 'col-span-3' : span === 2 ? 'col-span-2' : undefined}>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
          {inner}
        </a>
      ) : (
        <Link href={href} prefetch={false} className={className} data-seen-key={seenKey}>
          {inner}
        </Link>
      )}
    </li>
  )
}

/**
 * 最上段の横長の丸ボタン（マイページ・使い方）。
 * 「CiDAO の機能」ではなく「自分のこと・困ったとき」の入口なので、タイルと形を変える（2026-11-23 事業主決定・A案）。
 * solid＝紺の塗り、false＝白地に紺の枠
 */
export function PillRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className="cidao-stagger grid grid-cols-2 gap-2.5 sm:gap-3">{children}</ul>
    </nav>
  )
}

export function PillLink({
  href,
  icon: Icon,
  label,
  solid = false,
}: {
  href: string
  icon: LucideIcon
  label: string
  solid?: boolean
}) {
  const tone = solid
    ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white hover:bg-[#2a4d7a] dark:border-sky-700 dark:bg-sky-800 dark:hover:bg-sky-700'
    : 'border-[#1e3a5f] bg-white text-[#1e3a5f] hover:bg-slate-100 dark:border-sky-600 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-slate-800'
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={`cidao-tile flex min-h-11 items-center justify-center gap-1.5 rounded-full border-[1.5px] px-3 text-sm font-semibold transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${tone}`}
      >
        <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
        {label}
      </Link>
    </li>
  )
}

/**
 * 下段の丸いアイコン（3Dマップ・ぐるめ・防災・病院）。
 * 「あったらいいな」を形にした実例の入口。CiDAO の主な機能（角丸のタイル）と形で見分けられるようにする。
 * 色だけで区別させないよう、ラベルは必ず濃い色の文字で出す
 */
const ROUND_COLORS = {
  blue: { disc: 'bg-blue-600 dark:bg-blue-500', icon: 'text-white' },
  rose: { disc: 'bg-rose-600 dark:bg-rose-500', icon: 'text-white' },
  // 黄は白い絵だと読めないので、絵を濃い茶にする
  yellow: { disc: 'bg-yellow-400 dark:bg-yellow-400', icon: 'text-yellow-950' },
  teal: { disc: 'bg-teal-600 dark:bg-teal-500', icon: 'text-white' },
} satisfies Record<string, { disc: string; icon: string }>

export type RoundColor = keyof typeof ROUND_COLORS

export function RoundRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className="cidao-stagger grid grid-cols-4 gap-1 rounded-2xl border border-dashed border-slate-300 px-1 py-3 dark:border-slate-700">
        {children}
      </ul>
    </nav>
  )
}

export function RoundLink({
  href,
  icon: Icon,
  label,
  color,
  external = false,
  track,
}: {
  href: string
  icon: LucideIcon
  label: string
  color: RoundColor
  /** CiDAO の外のページ。新しいタブで開き、ラベルに小さな矢印を付ける */
  external?: boolean
  /** 押された回数を数えるときの名前（英数字）。/go/<名前> として閲覧数の表に入る（HomeTileEffects が送る） */
  track?: string
}) {
  const c = ROUND_COLORS[color]
  const className =
    'cidao-tile cidao-round group flex flex-col items-center gap-1.5 rounded-xl py-1 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500'
  const inner = (
    <>
      <span className={`cidao-round-disc flex size-14 items-center justify-center rounded-full ${c.disc}`}>
        <Icon aria-hidden className={`size-7 ${c.icon}`} strokeWidth={1.75} />
      </span>
      <span className="inline-flex items-center gap-0.5 text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-100">
        {label}
        {external && <ArrowUpRight aria-hidden className="size-3 text-slate-400" />}
      </span>
    </>
  )
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={`${label}（新しいタブで開く）`} data-track={track}>
          {inner}
        </a>
      ) : (
        <Link href={href} prefetch={false} className={className} data-track={track}>
          {inner}
        </Link>
      )}
    </li>
  )
}
