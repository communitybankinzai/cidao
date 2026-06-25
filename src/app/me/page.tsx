import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { summarize, evaluateBadges, ACTION_LABELS } from '@/lib/contribution-summary'
import { categoryLabel } from '@/lib/categories'
import { findMatchingOrgs, type EnrichedMatch } from '@/lib/match-orgs'

const ORG_TYPE_LABEL: Record<string, string> = {
  voluntary: '任意団体',
  civic: '市民活動団体',
  company: '企業',
  government: '行政',
}

const RECRUITMENT_BADGE: Record<string, { label: string; className: string }> = {
  open: {
    label: '🟢 募集中',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  unknown: {
    label: '⚪ 募集状況未確認',
    className: 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  },
  invitation_only: {
    label: '🔵 招待制',
    className: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  },
  closed: {
    label: '⛔ 募集停止中',
    className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800',
  },
}

const TIER_LABEL: Record<string, { label: string; weight_citizen: string; weight_related: string; color: string }> = {
  light:      { label: 'ライト登録',   weight_citizen: '0.1', weight_related: '0.1',  color: 'bg-slate-200 text-slate-800' },
  email_only: { label: '本登録',       weight_citizen: '0.3', weight_related: '0.15', color: 'bg-emerald-200 text-emerald-900' },
  verified:   { label: '住所確認済',   weight_citizen: '1.0', weight_related: '0.5',  color: 'bg-sky-200 text-sky-900' },
}

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/me')

  const { data: member } = await supabase
    .from('members')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!member) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>プロフィール取得に失敗しました</p>
      </div>
    )
  }

  const { data: contributions } = await supabase
    .from('contributions')
    .select('action_type, pt, created_at')
    .eq('actor_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const summary = summarize(contributions ?? [])
  const badges = evaluateBadges(contributions ?? [], summary.total)

  const { data: myProposals } = await supabase
    .from('proposals')
    .select('id, title, status, category, created_at')
    .eq('proposer_id', user.id)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(10)

  const tierInfo = TIER_LABEL[member.tier]

  // /me?updated=1（保存直後）かつ興味分野が入っているとき限り、match-orgs を呼ぶ
  // 通常閲覧では Claude API を叩かない（クレジット節約）
  let matchResult: EnrichedMatch[] | null = null
  let matchError: string | null = null
  if (sp.updated && (member.interests ?? []).length > 0) {
    try {
      const r = await findMatchingOrgs(user.id, supabase)
      if (r.ok) {
        matchResult = r.matches
      } else if (r.reason === 'no_candidates') {
        matchResult = []
      }
    } catch (err) {
      matchError = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </nav>

        {sp.updated && (
          <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-3 rounded text-sm">
            プロフィールを更新しました
          </div>
        )}

        {/* マッチング結果（更新直後のみ） */}
        {sp.updated && matchResult !== null && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex justify-between items-baseline">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                あなたに合う団体
              </h2>
              <span className="text-[10px] text-slate-400">AI が興味分野から提案</span>
            </div>
            {matchResult.length === 0 ? (
              <p className="text-sm text-slate-500">
                現状の興味分野に合致する団体は見つかりませんでした。
                <Link href="/orgs" className="text-slate-700 dark:text-slate-300 hover:underline ml-1">
                  全団体一覧から探す →
                </Link>
              </p>
            ) : (
              <ul className="space-y-3">
                {matchResult.map((m) => {
                  const badge = RECRUITMENT_BADGE[m.recruitment_status] ?? RECRUITMENT_BADGE.unknown
                  return (
                    <li key={m.org_id}>
                      <Link
                        href={`/orgs/${m.org_id}`}
                        className="block p-3 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 space-y-1.5"
                      >
                        <div className="flex justify-between items-baseline gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {m.name}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {ORG_TYPE_LABEL[m.type] ?? m.type}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{m.reason}</p>
                        <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${badge.className}`}>
                          {badge.label}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-[10px] text-slate-400">
              ⚪ 募集状況未確認の団体は、本物の代表者による情報更新（claim）待ちの状態です。問い合わせ前に印西市市民活動支援センター等で活動状況をご確認ください。
            </p>
            <div className="text-right">
              <Link href="/orgs" className="text-xs text-slate-500 hover:underline">
                すべての団体を見る →
              </Link>
            </div>
          </section>
        )}
        {sp.updated && matchError && (
          <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-3 rounded text-xs text-amber-900 dark:text-amber-100">
            マッチング処理に失敗しました（{matchError}）
          </div>
        )}

        <header className="space-y-3">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">マイページ</p>
          <div className="flex items-center gap-4">
            <Avatar src={member.avatar_url} name={member.display_name} size="xl" />
            <div className="flex-1 min-w-0 space-y-2">
              <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100 truncate">
                {member.display_name}
              </h1>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`px-2 py-1 rounded ${tierInfo.color}`}>{tierInfo.label}</span>
                <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-600">
                  {member.residency_type === 'citizen' ? '市民' : '関係人口'}
                </span>
                <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-600">
                  投票重み {member.residency_type === 'citizen' ? tierInfo.weight_citizen : tierInfo.weight_related}
                </span>
              </div>
            </div>
            <Link href="/me/edit" className="shrink-0">
              <Button size="sm" variant="outline">編集</Button>
            </Link>
          </div>
        </header>

        {/* tier 昇格動線 */}
        {member.tier === 'light' && (
          <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-4 rounded space-y-2">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              本登録すると提案・拘束的投票・コメントができます
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              プロフィールを完成させて投票重みを上げましょう（市民 0.1 → 0.3）
            </p>
            <Link href="/me/edit">
              <Button size="sm">本登録フォームを開く</Button>
            </Link>
          </div>
        )}
        {member.tier === 'email_only' && (
          <div className="bg-sky-50 dark:bg-sky-950 border-l-4 border-sky-500 p-4 rounded space-y-2">
            <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">
              住所確認で投票重みを最大化（市民 0.3 → 1.0）
            </p>
            <p className="text-xs text-sky-700 dark:text-sky-300">
              本人確認ハガキの発送機能は Phase 1 後半で実装予定
            </p>
          </div>
        )}

        {/* 貢献度サマリ */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex justify-between items-baseline">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">貢献度</h2>
            <span className="text-xs text-slate-400">月次上限: 320pt</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Metric label="累計" value={`${summary.total} pt`} />
            <Metric label="今月" value={`${summary.monthlyTotal} pt`} />
            <Metric label="アクション数" value={`${(contributions ?? []).length}`} />
          </div>

          {Object.keys(summary.byAction).length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-500">アクション内訳</summary>
              <ul className="mt-2 space-y-1">
                {Object.entries(summary.byAction)
                  .sort((a, b) => b[1].pt - a[1].pt)
                  .map(([key, v]) => (
                    <li key={key} className="flex justify-between text-xs">
                      <span>{ACTION_LABELS[key] ?? key}</span>
                      <span className="font-mono text-slate-600 dark:text-slate-400">
                        {v.count}回 / {v.pt}pt
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </section>

        {/* バッジ */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">達成バッジ</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {badges.map((b) => (
              <div
                key={b.key}
                className={`text-center p-3 rounded border ${
                  b.achieved
                    ? 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-400'
                }`}
                title={b.hint}
              >
                <div className="text-xs font-semibold">{b.label}</div>
                <div className="text-[10px] mt-1">{b.achieved ? '✓ 達成' : '未達成'}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 提案履歴 */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">あなたの提案</h2>
          {!myProposals || myProposals.length === 0 ? (
            <p className="text-sm text-slate-400">まだ提案はありません</p>
          ) : (
            <ul className="space-y-2">
              {myProposals.map((p) => (
                <li key={p.id}>
                  <Link href={`/proposals/${p.id}`} className="block p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="text-xs text-slate-500">{categoryLabel(p.category)} · {p.status}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 設定リンク */}
        <section className="flex justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <span className="text-sm">プロフィール編集・公開範囲設定</span>
          <Link href="/me/edit">
            <Button variant="outline" size="sm">編集</Button>
          </Link>
        </section>

        {member.ranking_opt_in && (
          <p className="text-xs text-center">
            <Link href="/ranking" className="text-slate-500 hover:underline">
              貢献度ランキングを見る →
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  )
}
