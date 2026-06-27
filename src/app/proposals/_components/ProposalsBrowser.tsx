'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { categoryLabel, budgetLabel, bindingMeta } from '@/lib/categories'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  discussion: { label: '議論中', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  voting:     { label: '投票中', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  passed:     { label: '可決',   color: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200' },
  rejected:   { label: '否決',   color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' },
  closed:     { label: '集計済', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  draft:      { label: '下書き', color: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

export type ProposalSummary = {
  id: string
  title: string
  category: string
  binding_type: string
  budget_size: string
  status: string
  discussion_start_at: string | null
  voting_start_at: string | null
  voting_end_at: string | null
  created_at: string
  snapshot: {
    yesPct: number | null   // 拘束: 賛成%、諮問: 協力できる%
    noPct: number | null    // 拘束: 反対%、諮問: 難しい%
    holdPct: number | null  // 拘束: 保留%、諮問: わからない%
    totalVotes: number
  }
}

type Tab = 'voting' | 'discussion' | 'result' | 'all'

function remainingLabel(endIso: string | null): string | null {
  if (!endIso) return null
  const ms = new Date(endIso).getTime() - Date.now()
  if (ms <= 0) return '締切済'
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  if (days > 0) return `あと ${days}日${hours}時間`
  return `あと ${hours}時間`
}

function discussionRemainingLabel(startIso: string | null): string | null {
  if (!startIso) return null
  const endMs = new Date(startIso).getTime() + 48 * 3600 * 1000
  const ms = endMs - Date.now()
  if (ms <= 0) return '間もなく投票へ'
  const hours = Math.floor(ms / 3600000)
  return `投票開始まで ${hours}時間`
}

export function ProposalsBrowser({
  proposals,
  isLoggedIn,
}: {
  proposals: ProposalSummary[]
  isLoggedIn: boolean
}) {
  const [tab, setTab] = useState<Tab>('voting')
  const [category, setCategory] = useState<string>('all')

  const counts = useMemo(() => ({
    voting: proposals.filter((p) => p.status === 'voting').length,
    discussion: proposals.filter((p) => p.status === 'discussion').length,
    result: proposals.filter((p) => ['passed', 'rejected', 'closed'].includes(p.status)).length,
    all: proposals.length,
  }), [proposals])

  const filtered = useMemo(() => {
    let list = proposals
    if (tab === 'voting')     list = list.filter((p) => p.status === 'voting')
    else if (tab === 'discussion') list = list.filter((p) => p.status === 'discussion')
    else if (tab === 'result') list = list.filter((p) => ['passed', 'rejected', 'closed'].includes(p.status))

    if (category !== 'all') list = list.filter((p) => p.category === category)

    if (tab === 'voting') {
      list = [...list].sort((a, b) =>
        new Date(a.voting_end_at ?? 0).getTime() - new Date(b.voting_end_at ?? 0).getTime()
      )
    } else if (tab === 'discussion') {
      list = [...list].sort((a, b) =>
        new Date(a.discussion_start_at ?? 0).getTime() - new Date(b.discussion_start_at ?? 0).getTime()
      )
    } else {
      list = [...list].sort((a, b) =>
        new Date(b.voting_end_at ?? b.created_at).getTime() - new Date(a.voting_end_at ?? a.created_at).getTime()
      )
    }
    return list
  }, [proposals, tab, category])

  const categoriesInScope = useMemo(() => {
    const set = new Set<string>()
    proposals.forEach((p) => set.add(p.category))
    return Array.from(set)
  }, [proposals])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TabChip label="投票中" count={counts.voting} active={tab === 'voting'} onClick={() => setTab('voting')} color="emerald" />
        <TabChip label="議論中" count={counts.discussion} active={tab === 'discussion'} onClick={() => setTab('discussion')} color="amber" />
        <TabChip label="結果" count={counts.result} active={tab === 'result'} onClick={() => setTab('result')} color="slate" />
        <TabChip label="すべて" count={counts.all} active={tab === 'all'} onClick={() => setTab('all')} color="slate" />

        {categoriesInScope.length > 1 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="ml-auto text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
          >
            <option value="all">すべての分野</option>
            {categoriesInScope.map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg p-12 text-center border border-slate-200 dark:border-slate-800">
          <p className="text-slate-500 text-sm">
            {tab === 'voting' ? '投票中の提案はありません' :
             tab === 'discussion' ? '議論中の提案はありません' :
             tab === 'result' ? 'まだ結果が出た提案はありません' :
             'まだ提案はありません'}
          </p>
          {isLoggedIn && (
            <Link href="/proposals/new" className="inline-block mt-3 text-xs text-emerald-600 dark:text-emerald-400 underline">
              新しい提案を投稿する →
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((p) => {
            const s = STATUS_LABELS[p.status] ?? STATUS_LABELS.draft
            const meta = bindingMeta(p.binding_type)
            const remain = p.status === 'voting' ? remainingLabel(p.voting_end_at)
                        : p.status === 'discussion' ? discussionRemainingLabel(p.discussion_start_at)
                        : null
            return (
              <li key={p.id}>
                <Link
                  href={`/proposals/${p.id}`}
                  className="block bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                      {p.title}
                    </h2>
                    <span className={`shrink-0 text-xs px-2 py-1 rounded ${s.color}`}>
                      {s.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(p.category)}</span>
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{budgetLabel(p.budget_size)}</span>
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                      {meta?.key === 'external' ? '諮問' : '拘束'}
                    </span>
                    {remain && (
                      <span className="ml-auto text-slate-400">{remain}</span>
                    )}
                  </div>

                  {(p.status === 'voting' || p.status === 'passed' || p.status === 'rejected' || p.status === 'closed')
                    && p.snapshot.totalVotes > 0 && meta && (
                    <Snapshot snapshot={p.snapshot} bindingKey={meta.key} />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TabChip({
  label, count, active, onClick, color,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  color: 'emerald' | 'amber' | 'slate'
}) {
  const activeStyle = {
    emerald: 'bg-emerald-600 text-white border-emerald-600',
    amber:   'bg-amber-500 text-white border-amber-500',
    slate:   'bg-slate-700 text-white border-slate-700 dark:bg-slate-300 dark:text-slate-900',
  }[color]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition ${
        active ? activeStyle : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
      }`}
    >
      {label}
      <span className={`ml-1.5 ${active ? 'opacity-90' : 'text-slate-400'}`}>({count})</span>
    </button>
  )
}

function Snapshot({
  snapshot, bindingKey,
}: {
  snapshot: ProposalSummary['snapshot']
  bindingKey: string
}) {
  const yesLabel = bindingKey === 'external' ? '協力できる' : '賛成'
  const noLabel = bindingKey === 'external' ? '難しい' : '反対'
  const holdLabel = bindingKey === 'external' ? 'わからない' : '保留'
  return (
    <div className="space-y-1 mt-1">
      <div className="flex h-1.5 rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
        {snapshot.yesPct !== null && snapshot.yesPct > 0 && (
          <div className="bg-emerald-500" style={{ width: `${snapshot.yesPct}%` }} />
        )}
        {snapshot.noPct !== null && snapshot.noPct > 0 && (
          <div className="bg-rose-500" style={{ width: `${snapshot.noPct}%` }} />
        )}
        {snapshot.holdPct !== null && snapshot.holdPct > 0 && (
          <div className="bg-slate-400" style={{ width: `${snapshot.holdPct}%` }} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
        {snapshot.yesPct !== null  && <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1 align-middle" />{yesLabel} {Math.round(snapshot.yesPct)}%</span>}
        {snapshot.noPct !== null   && <span><span className="inline-block w-2 h-2 rounded-sm bg-rose-500 mr-1 align-middle" />{noLabel} {Math.round(snapshot.noPct)}%</span>}
        {snapshot.holdPct !== null && <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-400 mr-1 align-middle" />{holdLabel} {Math.round(snapshot.holdPct)}%</span>}
        <span className="ml-auto">{snapshot.totalVotes}票</span>
      </div>
    </div>
  )
}
