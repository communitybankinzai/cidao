import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { loadOrganizerDistinctPairs, loadOrganizerReport, type OrganizerDistinctRow } from '@/lib/organizer-report-data'
import {
  distinctPairId,
  distinctPairRows,
  findSimilarCandidates,
  organizerYmdJst,
  type OrganizerGroup,
  type SimilarCandidate,
} from '@/lib/organizer-groups'
import {
  markOrganizersDistinct,
  mergeOrganizerGroups,
  undoOrganizersDistinct,
  unmergeOrganizerGroup,
  unmergeOrganizerKey,
} from './actions'

export const dynamic = 'force-dynamic'

const REASON_LABEL: Record<SimilarCandidate['reason'], string> = {
  contain: '片方がもう片方を含む',
  phonetic: 'カナと英字などの表記違い',
}

function normalizeForSearch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function groupMatches(g: OrganizerGroup, q: string): boolean {
  if (normalizeForSearch(g.name).includes(q)) return true
  return g.variants.some((v) => normalizeForSearch(v.text).includes(q))
}

function period(g: OrganizerGroup): string {
  const a = organizerYmdJst(g.first)
  const b = organizerYmdJst(g.last)
  return a === b ? a : `${a} 〜 ${b}`
}

function GroupCard({ g }: { g: OrganizerGroup }) {
  return (
    <div className="bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{g.name}</span>
        <span className="text-sm font-semibold tabular-nums">{g.count} 回</span>
        <span className="text-xs text-slate-500">{period(g)}</span>
        {g.merged && (
          <span className="text-[11px] rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200 px-2 py-0.5">
            名寄せ表でまとめた
          </span>
        )}
        {g.org && (
          <Link href={`/orgs/${g.org.id}`} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
            登録団体：{g.org.name}
          </Link>
        )}
      </div>
      <p className="text-xs text-slate-500">
        情報元：{g.sources.map((s) => `${s.label} ${s.count}`).join('・')}
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
          まとめた表記（{g.variants.length}種類）
        </summary>
        <ul className="mt-2 space-y-2">
          {g.keyDetails.map((k) => (
            <li key={k.key} className="border-l-2 border-slate-200 dark:border-slate-700 pl-3">
              <ul className="space-y-0.5">
                {k.variants.map((v) => (
                  <li key={v.text} className="break-all">
                    {v.text}
                    <span className="text-slate-500">　{v.count}回</span>
                  </li>
                ))}
              </ul>
              {k.aliased && (
                <form action={unmergeOrganizerKey} className="mt-1">
                  <input type="hidden" name="alias_key" value={k.key} />
                  <button type="submit" className="text-[11px] text-slate-500 hover:underline">
                    この表記をまとめから外す
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {g.merged && (
          <form action={unmergeOrganizerGroup} className="mt-2">
            <input type="hidden" name="canonical" value={g.name} />
            <Button type="submit" size="sm" variant="secondary">
              まとめを全部解除
            </Button>
          </form>
        )}
      </details>
    </div>
  )
}

function CandidateCard({ c }: { c: SimilarCandidate }) {
  const keys = JSON.stringify([...new Set([...c.a.keys, ...c.b.keys])])
  const olds = JSON.stringify([c.a, c.b].filter((g) => g.merged).map((g) => g.name))
  return (
    <div className="bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-3">
      <p className="text-[11px] text-slate-500">{REASON_LABEL[c.reason]}</p>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        {[c.a, c.b].map((g) => (
          <div key={g.id} className="rounded border border-slate-200 dark:border-slate-700 p-2">
            <div className="font-medium break-all">{g.name}</div>
            <div className="text-xs text-slate-500">
              {g.count} 回・{period(g)}
            </div>
          </div>
        ))}
      </div>
      <form action={mergeOrganizerGroups} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="keys" value={keys} />
        <input type="hidden" name="olds" value={olds} />
        <span className="text-xs text-slate-500">この2つをまとめる。まとめ先の名前：</span>
        <Button type="submit" name="canonical" value={c.a.name} size="sm" className="h-auto max-w-full whitespace-normal py-1.5 text-left break-all">
          「{c.a.name}」
        </Button>
        <Button type="submit" name="canonical" value={c.b.name} size="sm" variant="secondary" className="h-auto max-w-full whitespace-normal py-1.5 text-left break-all">
          「{c.b.name}」
        </Button>
      </form>
      <form action={markOrganizersDistinct} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="pairs" value={JSON.stringify(distinctPairRows(c.a, c.b))} />
        <input type="hidden" name="label_a" value={c.a.name} />
        <input type="hidden" name="label_b" value={c.b.name} />
        <Button type="submit" size="sm" variant="outline">
          別の団体です
        </Button>
        <span className="text-[11px] text-slate-500">次から候補に出しません（下の一覧から取り消せます）</span>
      </form>
    </div>
  )
}

/** 「別の団体です」の記録を、1回の記録ごとにまとめる（新しい順） */
function groupDecisions(rows: OrganizerDistinctRow[]): { id: string; a: string; b: string; at: string }[] {
  const map = new Map<string, { id: string; a: string; b: string; at: string }>()
  for (const r of rows) {
    if (!map.has(r.decision_id)) map.set(r.decision_id, { id: r.decision_id, a: r.label_a, b: r.label_b, at: r.created_at })
  }
  return [...map.values()].sort((x, y) => (x.at < y.at ? 1 : -1))
}

export default async function AdminOrganizersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { q: rawQ } = await searchParams
  const q = normalizeForSearch(rawQ ?? '')

  const [report, distinctRows] = await Promise.all([loadOrganizerReport(supabase), loadOrganizerDistinctPairs(supabase)])
  const distinct = new Set(distinctRows.map((r) => distinctPairId(r.key_a, r.key_b)))
  const candidates = findSimilarCandidates(report.groups, 150, distinct)
  const decisions = groupDecisions(distinctRows)
  const shown = q ? report.groups.filter((g) => groupMatches(g, q)) : report.groups

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-2">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">主催者の開催実績</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            掲載されているイベント（下書きを除く）を、主催者名の表記ゆれをまとめて団体別に数えた表です。
            <strong className="font-semibold">開催回数は「掲載された開催日の数」で、実際に開催された証拠ではありません。</strong>
            元の主催者名は書き換えず、まとめ方だけを「名寄せ表」に残します（いつでも解除できます）。
            市の部署は「課」の単位でまとめています。この画面は管理者だけが見られ、公開画面には出ません。
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            イベント {report.totalEvents} 件（主催者名なし {report.unnamedEvents} 件を除く）／ 表記 {report.rawKinds} 種類 →
            自動でまとめて {report.autoKinds} 種類 → 名寄せ表も反映して {report.groupKinds} 種類
          </p>
          <div>
            <a
              href="/admin/organizers/csv"
              className="inline-block text-xs border rounded px-3 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              CSV をダウンロード（Excel 用）
            </a>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">似ている候補（{candidates.length}件）</h2>
          <p className="text-xs text-slate-500">
            自動ではまとまらなかったが、同じ団体かもしれない組み合わせです。同じ団体なら、残したい名前のほうを押すとまとまります。
            別の団体なら「別の団体です」を押すと、次から候補に出ません。
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500 bg-white dark:bg-slate-900 border rounded-lg p-6">候補はありません。</p>
          ) : (
            <details>
              <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-300 mb-3">候補を開く</summary>
              <div className="space-y-3">
                {candidates.map((c) => (
                  <CandidateCard key={`${c.a.id}|${c.b.id}`} c={c} />
                ))}
              </div>
            </details>
          )}
          {decisions.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                別の団体として記録したもの（{decisions.length}件）
              </summary>
              <ul className="mt-2 space-y-2">
                {decisions.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 border rounded-lg px-3 py-2">
                    <span className="break-all">「{d.a}」と「{d.b}」</span>
                    <span className="text-slate-500">{organizerYmdJst(d.at)}</span>
                    <form action={undoOrganizersDistinct} className="ml-auto">
                      <input type="hidden" name="decision_id" value={d.id} />
                      <button type="submit" className="text-[11px] text-slate-500 hover:underline">
                        取り消す（また候補に出す）
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">
              団体別の実績（{q ? `${shown.length} / ${report.groups.length}` : report.groups.length}件・回数の多い順）
            </h2>
            <form className="ml-auto flex gap-2" action="/admin/organizers" method="get">
              <input
                type="search"
                name="q"
                defaultValue={rawQ ?? ''}
                placeholder="団体名・表記で検索"
                className="text-sm border rounded px-3 py-1.5 bg-white dark:bg-slate-900 w-56"
              />
              <Button type="submit" size="sm" variant="secondary">検索</Button>
            </form>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-slate-500 bg-white dark:bg-slate-900 border rounded-lg p-6">該当する団体がありません。</p>
          ) : (
            shown.map((g) => <GroupCard key={g.id} g={g} />)
          )}
        </section>
      </div>
    </div>
  )
}
