'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import {
  FREEFREE_CATEGORIES,
  FREEFREE_POSTER_KINDS,
  freefreeCategoryLabel,
  freefreePosterKindMeta,
  type FreefreePosterKind,
} from '@/lib/freefree-categories'

export type FreefreeRow = {
  id: string
  title: string
  body: string
  category: string
  location: string | null
  created_at: string
  expires_at: string | null
  posterKind: FreefreePosterKind
  orgName: string | null
}

type SortKey = 'newest' | 'expiring_soon'

export default function FreefreeBrowser({ rows }: { rows: FreefreeRow[] }) {
  const [posterFilter, setPosterFilter] = useState<FreefreePosterKind | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')

  const filtered = useMemo(() => {
    const now = Date.now()
    let r = rows
    if (posterFilter !== 'all') r = r.filter((p) => p.posterKind === posterFilter)
    if (categoryFilter !== 'all') r = r.filter((p) => p.category === categoryFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q) ||
        (p.orgName ?? '').toLowerCase().includes(q),
      )
    }
    if (sort === 'expiring_soon') {
      r = [...r].sort((a, b) => {
        const ea = a.expires_at ? new Date(a.expires_at).getTime() : Number.POSITIVE_INFINITY
        const eb = b.expires_at ? new Date(b.expires_at).getTime() : Number.POSITIVE_INFINITY
        return ea - eb
      }).filter((p) => !p.expires_at || new Date(p.expires_at).getTime() > now)
    }
    return r
  }, [rows, posterFilter, categoryFilter, search, sort])

  const posterCounts = useMemo(() => {
    const c: Record<string, number> = {}
    rows.forEach((p) => { c[p.posterKind] = (c[p.posterKind] ?? 0) + 1 })
    return c
  }, [rows])

  const hasActiveFilter = posterFilter !== 'all' || categoryFilter !== 'all' || search.trim().length > 0 || sort !== 'newest'

  return (
    <div className="space-y-4">
      <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-4">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500 mr-1">掲載者:</span>
          <Chip active={posterFilter === 'all'} onClick={() => setPosterFilter('all')} label={`すべて (${rows.length})`} />
          {FREEFREE_POSTER_KINDS.filter((k) => (posterCounts[k.key] ?? 0) > 0).map((k) => (
            <Chip
              key={k.key}
              active={posterFilter === k.key}
              onClick={() => setPosterFilter(k.key)}
              label={`${k.badge} (${posterCounts[k.key] ?? 0})`}
              className={posterFilter === k.key ? '' : k.badgeClass}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500 mr-1">カテゴリ:</span>
          <Chip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} label="すべて" />
          {FREEFREE_CATEGORIES.map((c) => (
            <Chip key={c.key} active={categoryFilter === c.key} onClick={() => setCategoryFilter(c.key)} label={c.label} />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="search"
            placeholder="🔍 タイトル・本文・場所・組織名で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
          >
            <option value="newest">新着順</option>
            <option value="expiring_soon">締切が近い順</option>
          </select>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => { setPosterFilter('all'); setCategoryFilter('all'); setSearch(''); setSort('newest') }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
            >
              フィルタを解除
            </button>
          )}
        </div>

        <div className="text-xs text-slate-500">
          {filtered.length} / {rows.length} 件
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-slate-400 text-center py-12">該当する掲載はありません</p>
      ) : (
        <ul className="grid md:grid-cols-2 gap-3">
          {filtered.map((p) => {
            const meta = freefreePosterKindMeta(p.posterKind)
            const daysLeft = p.expires_at
              ? Math.ceil((new Date(p.expires_at).getTime() - Date.now()) / 86400_000)
              : null
            const expiringSoon = daysLeft !== null && daysLeft <= 3 && daysLeft >= 0
            return (
              <li key={p.id}>
                <Link href={`/freefree/${p.id}`} className="block bg-white dark:bg-slate-900 border rounded-lg p-4 hover:border-slate-400 dark:hover:border-slate-600 transition">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.badgeClass}`}>{meta.badge}</span>
                    <span className="text-xs text-slate-500">{freefreeCategoryLabel(p.category)}</span>
                  </div>
                  <div className="font-semibold mb-1">{p.title}</div>
                  {p.orgName && <div className="text-xs text-slate-500 mb-1">by {p.orgName}</div>}
                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{p.body}</p>
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                    {p.location ? <span>📍 {p.location}</span> : <span />}
                    {expiringSoon && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ⏰ あと{daysLeft === 0 ? '本日まで' : `${daysLeft}日`}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Chip({ active, onClick, label, className }: { active: boolean; onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white dark:bg-white dark:text-slate-900'
          : `px-3 py-1 rounded-full text-xs border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 ${className ?? 'bg-slate-50 dark:bg-slate-800'}`
      }
    >
      {label}
    </button>
  )
}
