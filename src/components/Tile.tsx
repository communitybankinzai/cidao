import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'

/**
 * ホームなどに並べる「アイコン付きの大きなタイル」。
 *
 * 初めて使う人が、文章を読まずに「何ができるか」を絵と短い言葉で選べるようにする。
 * 1画面に並べるのは10個まで、ラベルは5〜6文字までを目安にする（2026-11-23 事業主決定で「病院」を足し、9個→10個）。
 * ホームの中段だけは、2026-11-25 の事業主決定で行動を伴う言い方にしたので、この目安より長い（最長12文字）。
 * 同じ日の事業主決定で、タイルの名前の文字を 13px → 16px にした（見本の B）。最長の名前は幅375px以上で1行、それより狭いと「・」の後ろで折れて2行になる。
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
 * - 2026-11-23：ホームの中段は solid（濃い塗り＋白い文字）、下段の丸は線だけにした（SOLID_BOX・ROUND_COLORS の説明を参照）
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
      <ul className={`cidao-stagger grid gap-2 sm:gap-3 ${cols === 6 ? 'grid-cols-6' : 'grid-cols-3'}`}>{children}</ul>
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

/**
 * 濃い塗り＋白い文字（ホームの中段）。
 * 2026-11-23 運営メンバーの意見（「下段の丸が濃くて、目が下へ行く」「メインのボタンが光り輝く感じに」）で、
 * 中段を濃く・下段を線だけにして強弱を入れ替えた（事業主決定・案1）。色あいは各ページの見出しと同じで、濃さだけ変える。
 * 白い文字が 4.5:1 以上になる濃さを選ぶ。上の明るい帯と影で、動かさずに光って見せる
 */
const SOLID_BOX: Partial<Record<TileColor, string>> = {
  indigo: 'bg-indigo-600 shadow-indigo-600/40',
  emerald: 'bg-emerald-700 shadow-emerald-700/40',
  violet: 'bg-violet-600 shadow-violet-600/40',
  orange: 'bg-orange-700 shadow-orange-700/40',
  amber: 'bg-amber-700 shadow-amber-700/40',
}
const SOLID_BASE =
  'border-white/25 bg-linear-to-b from-white/25 to-transparent to-60% shadow-lg hover:brightness-110 dark:shadow-none'

export function Tile({
  href,
  icon: Icon,
  label,
  color = 'sky',
  external = false,
  span,
  seenKey,
  badge,
  note,
  solid = false,
}: {
  href: string
  icon: LucideIcon
  label: string
  /** タイルの色。省略時は従来の淡い青 */
  color?: TileColor
  /** 濃い塗り＋白い文字にする（SOLID_BOX にある色だけ。無い色は淡いまま） */
  solid?: boolean
  /** CiDAO の外のページ（CBI サイトの食レポマップなど）。新しいタブで開く（2026-11-13） */
  external?: boolean
  /** TileGrid の cols={6} の中での幅（6＝横いっぱい、3＝半分、2＝3分の1） */
  span?: 2 | 3 | 6
  /** 新着の印（NewDot）と組で使う。押すと「見た」と覚える（HomeTileEffects が制御） */
  seenKey?: string
  /** 右上に重ねる印（新着の点など） */
  badge?: React.ReactNode
  /** 名前の下に出す短い1行（例：「投票中 4件」）。無ければ出さない */
  note?: string | null
}) {
  const solidBox = solid ? SOLID_BOX[color] : undefined
  const c: Color = solidBox
    ? { box: `${SOLID_BASE} ${solidBox}`, icon: 'text-white', label: 'text-white' }
    : COLORS[color]
  // 高さ（2026-11-25 事業主決定）：スマホで開いた最初の画面に、上段・中段・下段のボタンが全部入るように低くした。
  // 横いっぱいのタイル（span 6＝提案・投票する）は、アイコン・名前・件数を横に並べた帯。
  // はじめ56pxにしたが「縦幅が小さく、すぐ下の4つにより目立たなくなった」（同日・事業主）ので、
  // 80px・字20px・アイコン36pxにして、半分の幅のタイルは 80px → 70px に下げた（合計の高さはほぼ同じ。いちばん目立つのは横いっぱいのタイル）
  const big = span === 6
  const shape = big ? 'min-h-20 flex-row gap-3 py-2' : 'min-h-[70px] flex-col gap-1 py-1.5'
  const className = `cidao-tile relative flex h-full ${shape} items-center justify-center rounded-2xl border px-1 text-center transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${c.box}`
  const inner = (
    <>
      <Icon aria-hidden className={`${big ? 'size-9' : 'size-7'} ${c.icon}`} strokeWidth={1.75} />
      <span className={`${big ? 'text-xl' : 'text-base'} font-semibold leading-tight ${c.label}`}>
        <LabelText label={label} />
      </span>
      {note ? (
        <span className={`rounded-full bg-white/80 px-2.5 py-0.5 ${big ? 'text-xs' : 'text-[11px]'} font-semibold leading-tight text-slate-700 dark:bg-slate-900/60 dark:text-slate-200`}>
          {note}
        </span>
      ) : null}
      {badge}
    </>
  )
  return (
    <li className={span === 6 ? 'col-span-6' : span === 3 ? 'col-span-3' : span === 2 ? 'col-span-2' : undefined}>
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
 * タイルの名前。「・」の後ろでだけ折れるようにする（2026-11-25）。
 * 文字を16pxにしたので、幅の狭いスマホでは「イベントを見る・登録する」が2行になる。
 * そのままだと「登録す／る」のように途中で折れるため、「・」までをひとかたまりにする
 */
function LabelText({ label }: { label: string }) {
  const parts = label.split('・')
  if (parts.length === 1) return <>{label}</>
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="inline-block">
          {i < parts.length - 1 ? `${p}・` : p}
        </span>
      ))}
    </>
  )
}

/**
 * 最上段の横長の丸ボタン（マイページ・使い方）。
 * 「CiDAO の機能」ではなく「自分のこと・困ったとき」の入口なので、タイルと形を変える（2026-11-23 事業主決定・A案）。
 * solid＝紺の塗り、false＝白地に紺の枠
 */
export function PillRow({
  label,
  children,
  compact = false,
}: {
  label: string
  children: React.ReactNode
  /** 左寄せの小さい形（会員のホーム）。右上に浮いている連絡・管理・通知ベルと同じ行に並べるため、横いっぱいに広げない */
  compact?: boolean
}) {
  return (
    <nav aria-label={label}>
      <ul className={compact ? 'cidao-stagger flex gap-1.5' : 'cidao-stagger grid grid-cols-2 gap-2.5 sm:gap-3'}>{children}</ul>
    </nav>
  )
}

export function PillLink({
  href,
  icon: Icon,
  label,
  solid = false,
  compact = false,
}: {
  href: string
  icon: LucideIcon
  label: string
  solid?: boolean
  /** PillRow の compact と組で使う（高さ40px・字13px。右上の浮いているボタンと同じ高さ） */
  compact?: boolean
}) {
  const tone = solid
    ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white hover:bg-[#2a4d7a] dark:border-sky-700 dark:bg-sky-800 dark:hover:bg-sky-700'
    : 'border-[#1e3a5f] bg-white text-[#1e3a5f] hover:bg-slate-100 dark:border-sky-600 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-slate-800'
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={`cidao-tile flex ${compact ? 'min-h-10 gap-1 whitespace-nowrap text-[13px]' : 'min-h-11 gap-1.5 text-sm'} items-center justify-center rounded-full border-[1.5px] px-3 font-semibold transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${tone}`}
      >
        <Icon aria-hidden className={compact ? 'size-4' : 'size-[18px]'} strokeWidth={1.75} />
        {label}
      </Link>
    </li>
  )
}

/**
 * 下段の丸いアイコン（3Dマップ・ぐるめ・防災・病院）。
 * 「あったらいいな」を形にした実例の入口。CiDAO の主な機能（角丸のタイル）と形で見分けられるようにする。
 * 色だけで区別させないよう、ラベルは必ず濃い色の文字で出す
 *
 * 2026-11-23（事業主決定・案1）：丸を「濃い塗り」から「白地に色の線」へ変えた。
 * 濃い丸が中段より目立ち、目が下段へ行ってしまうという運営メンバーの意見による。中段（Tile の solid）と強弱を入れ替えてある
 */
const ROUND_DISC_BASE = 'border-[1.5px] bg-white dark:bg-slate-900'
const ROUND_COLORS = {
  blue: { disc: 'border-blue-600 dark:border-blue-400', icon: 'text-blue-600 dark:text-blue-300' },
  rose: { disc: 'border-rose-600 dark:border-rose-400', icon: 'text-rose-600 dark:text-rose-300' },
  // 黄は白地だと線が見えないので、濃い黄土にする
  yellow: { disc: 'border-yellow-700 dark:border-yellow-400', icon: 'text-yellow-700 dark:text-yellow-300' },
  teal: { disc: 'border-teal-600 dark:border-teal-400', icon: 'text-teal-600 dark:text-teal-300' },
  // バスマップ（2026-11-27）
  violet: { disc: 'border-violet-600 dark:border-violet-400', icon: 'text-violet-600 dark:text-violet-300' },
} satisfies Record<string, { disc: string; icon: string }>

export type RoundColor = keyof typeof ROUND_COLORS

export function RoundRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className="cidao-stagger grid grid-cols-4 gap-1 rounded-2xl border border-dashed border-slate-300 px-1 py-2 dark:border-slate-700">
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
      {/* 丸は 56px → 48px（2026-11-25・最初の画面に全部入れるため）。名前の文字は13pxのまま */}
      <span className={`cidao-round-disc flex size-12 items-center justify-center rounded-full ${ROUND_DISC_BASE} ${c.disc}`}>
        <Icon aria-hidden className={`size-6 ${c.icon}`} strokeWidth={1.75} />
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
