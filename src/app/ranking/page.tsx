import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const TIER_LABEL: Record<string, string> = {
  light: 'ライト登録',
  email_only: '通常登録',
  verified: '住所確認済',
}

export default async function RankingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RPC を使うのが理想だが Phase 1 では join + group は client side で
  // ranking_opt_in=true メンバーの contributions を集計
  const { data: optInMembers } = await supabase
    .from('members')
    .select('id, display_name, tier, residency_type')
    .eq('ranking_opt_in', true)
    .is('deleted_at', null)
    .limit(200)

  if (!optInMembers || optInMembers.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">貢献度ランキング</h1>
          <p className="text-sm text-slate-500">
            まだ誰も表示に同意していません。最初のひとりになりませんか？
          </p>
          {user && (
            <Link href="/me/edit" className="text-sm text-sky-600 underline">
              マイページで「ランキングに参加する」をON にする
            </Link>
          )}
        </div>
      </div>
    )
  }

  const ids = optInMembers.map((m) => m.id)
  const { data: contribs } = await supabase
    .from('contributions')
    .select('actor_id, pt')
    .in('actor_id', ids)

  const totalByMember = new Map<string, number>()
  for (const c of contribs ?? []) {
    totalByMember.set(c.actor_id, (totalByMember.get(c.actor_id) ?? 0) + c.pt)
  }

  const ranking = optInMembers
    .map((m) => ({ ...m, pt: totalByMember.get(m.id) ?? 0 }))
    .sort((a, b) => b.pt - a.pt)
    .slice(0, 50)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
          <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">貢献度ランキング</h1>
          <p className="text-xs text-slate-500 mt-2">
            「ランキングに参加する」設定にしたメンバーのみ掲載しています（{ranking.length}人）
          </p>
        </header>

        <ol className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
          {ranking.map((m, i) => (
            <li key={m.id} className="flex items-center gap-4 px-4 py-3">
              <span className={`w-8 text-center font-bold ${
                i === 0 ? 'text-amber-500 text-xl'
                : i === 1 ? 'text-slate-400 text-lg'
                : i === 2 ? 'text-amber-700 text-lg'
                : 'text-slate-400'
              }`}>
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{m.display_name}</div>
                <div className="text-xs text-slate-500">
                  {m.residency_type === 'citizen' ? '市民' : '関係人口'} · {TIER_LABEL[m.tier] ?? m.tier}
                </div>
              </div>
              <div className="font-mono text-right">
                <div className="text-lg font-bold">{m.pt}</div>
                <div className="text-[10px] text-slate-500">pt</div>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-xs text-slate-400 text-center">
          自分も表示するには <Link href="/me/edit" className="underline">マイページから参加</Link>
        </p>
      </div>
    </div>
  )
}
