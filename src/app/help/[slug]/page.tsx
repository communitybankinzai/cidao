import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { HELP_TOPICS, getHelpTopic, topicSeconds } from '@/lib/help-guide'
import { TopicPlayer } from '../_components/TopicPlayer'

// 機能の一覧は決まっているので、ビルド時に作っておく（開くたびにサーバーで組み立てない）
export const dynamicParams = false

export function generateStaticParams() {
  return HELP_TOPICS.map((t) => ({ slug: t.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const t = getHelpTopic(slug)
  if (!t) return { title: '使い方ヘルプ | CiDAO' }
  return {
    title: `${t.title}の使い方 | CiDAO`,
    description: t.summary,
  }
}

export default async function HelpTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const t = getHelpTopic(slug)
  if (!t) notFound()

  const i = HELP_TOPICS.findIndex((x) => x.slug === slug)
  const prev = i > 0 ? HELP_TOPICS[i - 1] : null
  const next = i < HELP_TOPICS.length - 1 ? HELP_TOPICS[i + 1] : null
  const sec = topicSeconds(t)

  return (
    <PageShell feature="help" width="narrow">
      <PageHeader feature="help"
        eyebrow="使い方ヘルプ"
        title={<><span aria-hidden className="mr-2">{t.emoji}</span>{t.title}</>}
        back={{ href: '/help', label: '使い方ヘルプ（機能の一覧）' }}
        description={
          <>
            {t.reading && <span className="block text-xs text-slate-500">読み：{t.reading}</span>}
            {t.summary}
            <span className="mt-1 block text-xs text-slate-500">音声の長さ：約{Math.max(1, Math.round(sec / 60))}分</span>
          </>
        }
      />

      <TopicPlayer clips={t.clips} />

      <section aria-label="実際の画面を開く" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">実際に使ってみる</h2>
        <ul className="flex flex-wrap gap-2">
          {t.links.map((l) => {
            const external = /^https?:/.test(l.href)
            return (
              <li key={l.href}>
                {external ? (
                  <a href={l.href} target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-full bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700">
                    {l.label} ↗
                  </a>
                ) : (
                  <Link href={l.href}
                    className="inline-flex min-h-11 items-center rounded-full bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700">
                    {l.label}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <nav aria-label="ほかの機能" className="flex items-stretch justify-between gap-3 text-sm">
        {prev ? (
          <Link href={`/help/${prev.slug}`} className="flex min-h-12 flex-1 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:border-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <span aria-hidden>←</span>{prev.emoji} {prev.title}
          </Link>
        ) : <span className="flex-1" />}
        {next ? (
          <Link href={`/help/${next.slug}`} className="flex min-h-12 flex-1 items-center justify-end gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-slate-700 hover:border-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {next.emoji} {next.title}<span aria-hidden>→</span>
          </Link>
        ) : <span className="flex-1" />}
      </nav>
    </PageShell>
  )
}
