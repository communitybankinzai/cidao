'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PROPOSAL_CATEGORIES, categoryLabel } from '@/lib/categories'

const TYPE_LABEL: Record<string, string> = {
  voluntary: '任意団体',
  civic: '市民活動団体',
  company: '企業',
  government: '行政',
}

const TYPE_ORDER: Array<keyof typeof TYPE_LABEL> = ['voluntary', 'civic', 'company', 'government']

type OrgCategory = { category: string; is_primary: boolean }
type Org = {
  id: string
  name: string
  type: string
  description: string | null
  public_flag: boolean
  organization_categories: OrgCategory[] | null
}

export default function OrgsBrowser({ orgs }: { orgs: Org[] }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orgs) c[o.type] = (c[o.type] ?? 0) + 1
    return c
  }, [orgs])

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orgs) {
      for (const cat of o.organization_categories ?? []) {
        c[cat.category] = (c[cat.category] ?? 0) + 1
      }
    }
    return c
  }, [orgs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orgs.filter((o) => {
      if (typeFilter && o.type !== typeFilter) return false
      if (categoryFilter && !(o.organization_categories ?? []).some((c) => c.category === categoryFilter)) return false
      if (q) {
        const hay = `${o.name} ${o.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [orgs, query, typeFilter, categoryFilter])

  const hasActiveFilter = !!query || !!typeFilter || !!categoryFilter

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="団体名・説明文で検索"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>
              すべての種別
            </FilterChip>
            {TYPE_ORDER.map((t) => {
              const count = typeCounts[t] ?? 0
              if (!count) return null
              return (
                <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
                  {TYPE_LABEL[t]} <span className="text-slate-400">{count}</span>
                </FilterChip>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={categoryFilter === null} onClick={() => setCategoryFilter(null)}>
              すべての分野
            </FilterChip>
            {PROPOSAL_CATEGORIES.map((c) => {
              const count = categoryCounts[c.key] ?? 0
              if (!count) return null
              return (
                <FilterChip
                  key={c.key}
                  active={categoryFilter === c.key}
                  onClick={() => setCategoryFilter(categoryFilter === c.key ? null : c.key)}
                >
                  {c.label} <span className="text-slate-400">{count}</span>
                </FilterChip>
              )
            })}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 flex items-center justify-between">
        <span>{filtered.length} / {orgs.length} 団体</span>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setQuery(''); setTypeFilter(null); setCategoryFilter(null) }}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
          >
            フィルタを解除
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-slate-400 text-center py-12">
          {orgs.length === 0 ? '団体はまだありません' : '該当する団体がありません'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((o) => {
            const cats = o.organization_categories ?? []
            const primary = cats.find((c) => c.is_primary) ?? cats[0]
            const extra = cats.filter((c) => c !== primary)
            return (
              <li key={o.id}>
                <Link
                  href={`/orgs/${o.id}`}
                  className="flex h-full flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-slate-400 dark:hover:border-slate-600 transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="text-base font-semibold leading-snug">{o.name}</h2>
                    <span className="shrink-0 text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                      {TYPE_LABEL[o.type] ?? o.type}
                    </span>
                  </div>
                  {o.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 mb-3">{o.description}</p>
                  )}
                  {cats.length > 0 && (
                    <div className="mt-auto flex flex-wrap gap-1">
                      {primary && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                          {categoryLabel(primary.category)}
                        </span>
                      )}
                      {extra.map((c) => (
                        <span
                          key={c.category}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        >
                          {categoryLabel(c.category)}
                        </span>
                      ))}
                    </div>
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

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-xs px-2.5 py-1 rounded-full border transition ' +
        (active
          ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:border-slate-500')
      }
    >
      {children}
    </button>
  )
}
