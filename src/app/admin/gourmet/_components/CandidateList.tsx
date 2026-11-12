'use client'

// 食レポの候補の一覧：地域で絞り込み・並べ替え（2026-11-13 事業主指示「範囲外でもソートで表示（デフォルトで市内のみ）」）。
// 既定は市内のみ（市内＋地域が決められないもの）。周辺6市町・範囲外は切り替えて見る。範囲外のお店は地図に載せられない（承認できない）。
import { useMemo, useState } from 'react'
import { CandidateCard } from './CandidateCard'
import { areaRank, areaVisible, candidateAreaClass, type AreaFilter } from '@/lib/gourmet-area-class'
import type { CandidateRow } from '@/lib/gourmet-candidates'

const FILTERS: Array<{ value: AreaFilter; label: string }> = [
  { value: 'inzai', label: '市内のみ' },
  { value: 'near', label: '市内＋周辺6市町' },
  { value: 'all', label: 'すべて（範囲外も）' },
]

export function CandidateList({ candidates }: { candidates: CandidateRow[] }) {
  const [filter, setFilter] = useState<AreaFilter>('inzai')
  const classes = useMemo(() => new Map(candidates.map((c) => [c.id, candidateAreaClass(c.shops)])), [candidates])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, candidates.filter((c) => areaVisible(classes.get(c.id)!, f.value)).length])) as Record<AreaFilter, number>, [candidates, classes])
  // 市内→地域不明→周辺→範囲外の順。同じ区分の中は、渡された順（新しい順）を保つ
  const shown = useMemo(
    () => candidates.filter((c) => areaVisible(classes.get(c.id)!, filter)).map((c, i) => ({ c, i })).sort((a, b) => areaRank(classes.get(a.c.id)!) - areaRank(classes.get(b.c.id)!) || a.i - b.i).map((x) => x.c),
    [candidates, classes, filter],
  )
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="地域で絞り込む" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">表示する地域</span>
        {FILTERS.map((f) => (
          <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)}
            className={`rounded border px-3 py-1 ${filter === f.value ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900' : 'border-slate-300 dark:border-slate-700'}`}>
            {f.label}（{counts[f.value]}）
          </button>
        ))}
      </div>
      {filter === 'all' && <p className="text-xs text-slate-500">範囲（印西市＋周辺6市町）の外のお店は地図に載せられません。確認・却下だけできます。</p>}
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">この地域の候補はありません。</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <CandidateCard key={c.id} id={c.id} postUrl={c.post_url} source={c.source} authorHandle={c.author_handle} postedAt={c.posted_at}
              moreShops={c.more_shops} holdReason={c.hold_reason} shops={c.shops} />
          ))}
        </ul>
      )}
    </div>
  )
}
