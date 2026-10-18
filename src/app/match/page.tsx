import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import MatchChat, { type MatchMode } from './_components/MatchChat'
import { createClient } from '@/lib/supabase/server'
import { getCivicGroupCount } from '@/lib/org-count'

const TABS: Array<{ key: MatchMode; label: string }> = [
  { key: 'orgs', label: '団体を探す' },
  { key: 'members', label: 'メンバーを探す' },
]

export default async function MatchPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams
  const mode: MatchMode = sp.mode === 'members' ? 'members' : 'orgs'

  const supabase = await createClient()
  const orgCount = await getCivicGroupCount(supabase)
  const subtitle =
    mode === 'members'
      ? '登録メンバーから、声をかけたい人を AI と会話で探します。'
      : `印西市内${orgCount ? ` ${orgCount} ` : 'の'}団体から、あなたに合う活動先を AI と会話で絞り込みます。`

  return (
    <PageShell width="form">
      <PageHeader
        title="マッチング相談"
        description={
          <>
            <strong className="text-slate-800 dark:text-slate-200">団体</strong>または<strong className="text-slate-800 dark:text-slate-200">メンバー</strong>から、あなたに合う相手を AI と会話で探します。
          </>
        }
      />

      {/* モード切替タブ */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'orgs' ? '/match' : `/match?mode=${t.key}`}
            role="tab"
            aria-selected={mode === t.key}
            className={
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ' +
              (mode === t.key
                ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        {subtitle}
      </p>

      <MatchChat mode={mode} />
    </PageShell>
  )
}
