import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { FEATURES, HEADER_COLORS, type FeatureKey } from '@/components/features'

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
}) {
  const f = feature ? FEATURES[feature] : null
  const Icon = f?.icon
  const hc = f ? HEADER_COLORS[f.color] : null
  return (
    <>
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {(Icon || eyebrow) && (
              <div className="mb-1 flex items-center gap-2">
                {Icon && hc && (
                  <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${hc.chip}`}>
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                )}
                {eyebrow && (
                  <p className={`text-xs uppercase tracking-[0.3em] ${hc ? hc.eyebrow : 'text-slate-500'}`}>{eyebrow}</p>
                )}
              </div>
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
      </header>
    </>
  )
}
