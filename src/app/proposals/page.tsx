import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { categoryLabel, budgetLabel, bindingMeta } from '@/lib/categories'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  discussion: { label: '議論中', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  voting:     { label: '投票中', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  passed:     { label: '可決',   color: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200' },
  rejected:   { label: '否決',   color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' },
  closed:     { label: '集計済', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  draft:      { label: '下書き', color: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

export default async function ProposalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, title, category, binding_type, budget_size, status, discussion_start_at, voting_end_at, created_at')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">提案一覧</h1>
          </div>
          {user ? (
            <Link href="/proposals/new">
              <Button>新しい提案</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline">ログインして提案する</Button>
            </Link>
          )}
        </header>

        {!proposals || proposals.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center border border-slate-200 dark:border-slate-800">
            <p className="text-slate-500">まだ提案はありません。</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {proposals.map((p) => {
              const s = STATUS_LABELS[p.status] ?? STATUS_LABELS.draft
              const b = bindingMeta(p.binding_type)
              return (
                <li key={p.id}>
                  <Link href={`/proposals/${p.id}`} className="block bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                        {p.title}
                      </h2>
                      <span className={`shrink-0 text-xs px-2 py-1 rounded ${s.color}`}>
                        {s.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(p.category)}</span>
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{budgetLabel(p.budget_size)}</span>
                      <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                        {b?.key === 'external' ? '諮問' : '拘束'}
                      </span>
                      {p.voting_end_at && p.status === 'voting' && (
                        <span className="ml-auto text-slate-400">
                          〜 {new Date(p.voting_end_at).toLocaleDateString('ja-JP')}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-xs text-slate-400 text-center pt-4">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </p>
      </div>
    </div>
  )
}
