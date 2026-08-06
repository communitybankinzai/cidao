'use client'

import { useMemo, useState } from 'react'
import SnsDraftEditor, { type DraftLog } from './SnsDraftEditor'

// 承認待ちリストの絞り込み・並び替え。
// 対象（提案/FreeFree/イベント/団体）と媒体が混在して件数が多くなるため、
// チップで絞り込んでから確認・承認できるようにする。

const TARGET_FILTERS: Array<[string, string]> = [
  ['all', 'すべて'],
  ['proposal', '📮 提案'],
  ['freefree', '🛍 FreeFree'],
  ['event', '📅 イベント'],
  ['org', '👥 団体'],
]

const MEDIUM_FILTERS: Array<[string, string]> = [
  ['all', 'すべて'],
  ['threads', '🧵 Threads'],
  ['instagram', '📷 IG'],
  ['facebook', '📘 FB'],
  ['line', '💬 LINE'],
  ['x', '𝕏'],
]

export default function AwaitingList({ logs }: { logs: DraftLog[] }) {
  const [targetFilter, setTargetFilter] = useState('all')
  const [mediumFilter, setMediumFilter] = useState('all')
  const [newestFirst, setNewestFirst] = useState(true)

  const countByTarget = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of logs) m.set(l.target_type, (m.get(l.target_type) ?? 0) + 1)
    return m
  }, [logs])
  const countByMedium = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of logs) m.set(l.medium, (m.get(l.medium) ?? 0) + 1)
    return m
  }, [logs])

  const filtered = useMemo(() => {
    const list = logs.filter(
      (l) =>
        (targetFilter === 'all' || l.target_type === targetFilter) &&
        (mediumFilter === 'all' || l.medium === mediumFilter),
    )
    return list.sort((a, b) =>
      newestFirst
        ? b.created_at.localeCompare(a.created_at)
        : a.created_at.localeCompare(b.created_at),
    )
  }, [logs, targetFilter, mediumFilter, newestFirst])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500 mr-1">対象:</span>
        {TARGET_FILTERS.map(([key, label]) => {
          const count = key === 'all' ? logs.length : (countByTarget.get(key) ?? 0)
          return (
            <FilterChip
              key={key}
              active={targetFilter === key}
              disabled={count === 0}
              onClick={() => setTargetFilter(key)}
              label={`${label}（${count}）`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500 mr-1">媒体:</span>
        {MEDIUM_FILTERS.map(([key, label]) => {
          const count = key === 'all' ? logs.length : (countByMedium.get(key) ?? 0)
          return (
            <FilterChip
              key={key}
              active={mediumFilter === key}
              disabled={count === 0}
              onClick={() => setMediumFilter(key)}
              label={`${label}（${count}）`}
            />
          )
        })}
        <button
          type="button"
          onClick={() => setNewestFirst(!newestFirst)}
          className="ml-auto px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {newestFirst ? '↓ 新しい順' : '↑ 古い順'}
        </button>
      </div>

      {filtered.length > 0 ? (
        <ul className="space-y-3 max-h-[36rem] overflow-y-auto">
          {filtered.map((l) => (
            <SnsDraftEditor key={l.id} log={l} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400 text-center py-4">この条件の承認待ちはありません</p>
      )}
      {filtered.length !== logs.length && (
        <p className="text-xs text-slate-500 text-right">{logs.length} 件中 {filtered.length} 件を表示</p>
      )}
    </div>
  )
}

function FilterChip({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
          : disabled
            ? 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 cursor-default'
            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  )
}
