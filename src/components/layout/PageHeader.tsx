import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { FEATURES, HEADER_COLORS, type FeatureKey } from '@/components/features'
import { HELP_SLUG_BY_FEATURE } from '@/lib/help-guide'

/**
 * 「← 前のページへ」のリンク。押しやすい高さ（40px以上）で、全ページ同じ見た目にする。
 * PageHeader の中でも、見出しが特別な詳細ページでも使う。
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <nav aria-label="前のページへ">
      <Link
        href={href}
        className="-ml-1 inline-flex min-h-10 items-center gap-0.5 rounded-md pr-2 text-sm text-slate-500 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {children}
      </Link>
    </nav>
  )
}

/**
 * 見出しの上の「機能の色のアイコン＋小見出し」。ホームのタイルと同じ色・アイコン。
 * PageHeader の中でも、見出しが特別な詳細ページ・入力フォームでも使う。
 * label を null にするとアイコンだけ出す。
 */
export function FeatureEyebrow({ feature, label = 'Citizen DAO' }: { feature: FeatureKey; label?: string | null }) {
  const f = FEATURES[feature]
  const Icon = f.icon
  const hc = HEADER_COLORS[f.color]
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${hc.chip}`}>
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      {label && <p className={`text-xs uppercase tracking-[0.3em] ${hc.eyebrow}`}>{label}</p>}
    </div>
  )
}

/**
 * ページの先頭（戻るリンク＋見出し＋説明＋右側の操作ボタン）。
 *
 * 見出しの大きさ（text-2xl／md:text-3xl）、「Citizen DAO」の小見出し、
 * 戻るリンクの押しやすさ（高さ40px以上）をそろえる。
 * PageShell の中に置く（戻るリンクと見出しは、PageShell の space-y-6 の兄弟になる）。
 */
export function PageHeader({
  title,
  description,
  back = { href: '/', label: 'ホーム' },
  eyebrow = 'Citizen DAO',
  actions,
  feature,
  compact = false,
  summary,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** null で戻るリンクを出さない。既定はホームへ */
  back?: { href: string; label: string } | null
  /** null／空で小見出しを出さない */
  eyebrow?: string | null
  /** 右側の操作ボタン（「団体登録」など） */
  actions?: React.ReactNode
  /** ホームのタイルと同じ色・アイコンを、見出しの左のチップと小見出しに使う */
  feature?: FeatureKey
  /**
   * 詰めた形（2026-11-27 事業主の指示「TOPに合わせて各ページもシンプルに」・まず予定ページを見本に）。
   * ホームと同じ考え方で、最初の画面は「アイコン＋題名」と1行の説明（summary）だけにし、
   * 長い説明（description）と使い方の入口は「くわしく見る」の中へ入れる。戻るリンクと小見出しは出さない（下のメニューにホームがある）
   */
  compact?: boolean
  /** compact のときに題名の下へ出す1行 */
  summary?: React.ReactNode
}) {
  if (compact) {
    const f = feature ? FEATURES[feature] : null
    const Icon = f?.icon
    const hc = f ? HEADER_COLORS[f.color] : null
    const helpSlug = feature ? HELP_SLUG_BY_FEATURE[feature] : undefined
    // 戻るリンクは、ホーム以外へ戻るページ（使い方の各ページ・マイページの下など）だけ出す。ホームへは下のメニューから戻れる
    const showBack = back && back.href !== '/'
    // 小見出しは、そのページだけの特別なもの（「使い方ヘルプ」など）だけ出す
    const showEyebrow = eyebrow && eyebrow !== 'Citizen DAO'
    return (
      <header className="space-y-1.5">
        {showBack && <BackLink href={back.href}>{back.label}</BackLink>}
        {showEyebrow && <p className={`text-xs tracking-[0.2em] ${hc ? hc.eyebrow : 'text-slate-500'}`}>{eyebrow}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex min-w-0 items-center gap-2 font-serif text-xl font-bold text-slate-900 md:text-3xl dark:text-slate-100">
            {Icon && hc && (
              <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${hc.chip}`}>
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
            )}
            <span className="min-w-0">{title}</span>
          </h1>
          {actions}
        </div>
        {summary && <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p>}
        {(description || helpSlug) && (
          <details className="text-sm text-slate-600 dark:text-slate-400">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              くわしく見る
            </summary>
            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-xs leading-relaxed dark:border-slate-800 dark:bg-slate-900">
              {description}
              {helpSlug && (
                <p>
                  <Link href={`/help/${helpSlug}`} className="inline-flex min-h-10 items-center gap-1 text-sm text-sky-700 hover:underline dark:text-sky-300">
                    📖 この機能の使い方（画面と音声で説明）
                  </Link>
                </p>
              )}
            </div>
          </details>
        )}
      </header>
    )
  }
  return (
    <>
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {feature ? (
              <div className="mb-1">
                <FeatureEyebrow feature={feature} label={eyebrow} />
              </div>
            ) : (
              eyebrow && <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{eyebrow}</p>
            )}
            <h1 className="font-serif text-2xl font-bold text-slate-900 md:text-3xl dark:text-slate-100">
              {title}
            </h1>
          </div>
          {actions}
        </div>
        {description && (
          <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{description}</div>
        )}
        {feature && HELP_SLUG_BY_FEATURE[feature] && (
          <p>
            <Link
              href={`/help/${HELP_SLUG_BY_FEATURE[feature]}`}
              className="inline-flex min-h-10 items-center gap-1 text-sm text-sky-700 hover:underline dark:text-sky-300"
            >
              📖 この機能の使い方（画面と音声で説明）
            </Link>
          </p>
        )}
      </header>
    </>
  )
}
