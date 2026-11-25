/**
 * 各ページ共通の骨組み（背景・余白・幅）。
 *
 * これまでは各ページが「min-h-screen bg-slate-50 p-6 md:p-12 > max-w-5xl mx-auto space-y-6」を
 * 自分で書いていて、余白（p-4／p-6／p-8）や幅（max-w-2xl／4xl／5xl）がページごとに違っていた。
 * ここに集めて、見た目をそろえる。
 *
 * width
 * - default：一覧・詳細ページ（max-w-5xl）
 * - form   ：入力フォーム（max-w-3xl）
 * - narrow ：読み物・設定・ログインなど（max-w-2xl）
 *
 * feature
 * - ホームのタイルと同じ「機能の色」を、そのページの主なボタン・選んだ印に使う（globals.css の .accent-*）
 */
import { FEATURES, type FeatureKey } from '@/components/features'

const WIDTH = {
  default: 'max-w-5xl',
  form: 'max-w-3xl',
  narrow: 'max-w-2xl',
} as const

export function PageShell({
  children,
  width = 'default',
  feature,
  dense = false,
  topBarRow = false,
}: {
  children: React.ReactNode
  width?: keyof typeof WIDTH
  feature?: FeatureKey
  /** スマホでの上の余白と、かたまりどうしのすき間を詰める（ホーム用。最初の画面にボタンを全部入れるため・2026-11-25）。パソコンの幅では変わらない */
  dense?: boolean
  /** dense と組で使う。スマホでの上の余白を、右上に浮いているボタン（連絡・管理・通知ベル。top-3＝12px）と同じにして、
   *  本文の1行目をそのボタンと同じ行に並べる（会員のホーム・2026-11-25） */
  topBarRow?: boolean
}) {
  return (
    <div className={`min-h-screen bg-slate-50 px-4 ${dense ? `${topBarRow ? 'pt-3' : 'pt-4'} pb-6` : 'py-6'} md:p-12 dark:bg-slate-950${feature ? ` accent-${FEATURES[feature].color}` : ''}`}>
      <main className={`mx-auto w-full ${dense ? 'space-y-4 md:space-y-6' : 'space-y-6'} ${WIDTH[width]}`}>{children}</main>
    </div>
  )
}
