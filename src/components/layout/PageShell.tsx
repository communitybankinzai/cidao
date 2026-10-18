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
 */
const WIDTH = {
  default: 'max-w-5xl',
  form: 'max-w-3xl',
  narrow: 'max-w-2xl',
} as const

export function PageShell({
  children,
  width = 'default',
}: {
  children: React.ReactNode
  width?: keyof typeof WIDTH
}) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 md:p-12 dark:bg-slate-950">
      <main className={`mx-auto w-full space-y-6 ${WIDTH[width]}`}>{children}</main>
    </div>
  )
}
