import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import type { Metadata } from 'next'
import { HELP_TOPICS, topicSeconds } from '@/lib/help-guide'

export const metadata: Metadata = {
  title: '使い方ヘルプ | CiDAO',
  description: 'CiDAOの使い方を、機能ごとに画面と音声で説明します。スマホでも見られます。',
}

function minutesLabel(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`
}

export default function HelpPage() {
  return (
    <PageShell feature="help" width="narrow">
      <PageHeader feature="help"
        title="使い方ヘルプ"
        description={
          <>
            知りたい機能を選んでください。画面の写真と文章、音声で説明します（スマホでも見られます）。
            わからないことや困ったことがあれば
            <Link href="/bug-report?source=cidao_app&category=question" className="mx-1 text-blue-600 hover:underline">運営に相談・不具合を知らせる</Link>
            からお知らせください。返事は画面右上のベル🔔に届きます。
          </>
        }
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="機能の一覧">
        {HELP_TOPICS.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/help/${t.slug}`}
              className="flex h-full min-h-24 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="text-2xl leading-none">{t.emoji}</span>
                <span className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.title}</span>
              </span>
              <span className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{t.summary}</span>
              <span className="mt-auto pt-1 text-xs font-medium text-sky-700 dark:text-sky-300">
                🔊 音声つき・{minutesLabel(topicSeconds(t))}
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/help/notifications"
            className="flex h-full min-h-24 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="text-2xl leading-none">🔔</span>
              <span className="text-base font-semibold text-slate-900 dark:text-slate-100">通知・提案の出し方</span>
            </span>
            <span className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              通知が届く場面と止め方、スマホへの通知の設定、提案の出し方のコツです。
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/help/auto-listing"
            className="flex h-full min-h-24 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="text-2xl leading-none">📅</span>
              <span className="text-base font-semibold text-slate-900 dark:text-slate-100">催しをカレンダーに載せるには（団体の方へ）</span>
            </span>
            <span className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Instagram の告知が自動で載る条件（プロアカウント）と、自分で登録する方法です。
            </span>
          </Link>
        </li>
      </ul>
    </PageShell>
  )
}
