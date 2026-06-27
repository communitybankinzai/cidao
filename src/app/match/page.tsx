import Link from 'next/link'
import MatchChat, { type MatchMode } from './_components/MatchChat'

const TABS: Array<{ key: MatchMode; label: string; subtitle: string }> = [
  { key: 'orgs', label: '団体を探す', subtitle: '印西市内 219 団体から、あなたに合う活動先を AI と会話で絞り込みます。' },
  { key: 'members', label: 'メンバーを探す', subtitle: '登録メンバーから、声をかけたい人を AI と会話で探します。' },
]

export default async function MatchPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams
  const mode: MatchMode = sp.mode === 'members' ? 'members' : 'orgs'
  const active = TABS.find((t) => t.key === mode) ?? TABS[0]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="space-y-2">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Agent A7 · Match</p>
          <h1 className="text-3xl font-serif font-bold">マッチング相談</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <strong className="text-slate-800 dark:text-slate-200">団体</strong>または<strong className="text-slate-800 dark:text-slate-200">メンバー</strong>から、あなたに合う相手を AI と会話で探します。
          </p>
        </header>

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
          {active.subtitle}
        </p>

        <MatchChat mode={mode} />
      </div>
    </div>
  )
}
