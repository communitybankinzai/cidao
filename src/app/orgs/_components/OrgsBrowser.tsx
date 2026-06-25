'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PROPOSAL_CATEGORIES, categoryLabel } from '@/lib/categories'
import { Avatar } from '@/components/ui/avatar'

const TYPE_LABEL: Record<string, string> = {
  voluntary: '任意団体',
  civic: '市民活動団体',
  company: '企業',
  government: '行政',
}

const TYPE_ORDER: Array<keyof typeof TYPE_LABEL> = ['voluntary', 'civic', 'company', 'government']

const MEMBERS_PREVIEW = 5

type OrgCategory = { category: string; is_primary: boolean }
type MemberView = { display_name: string; avatar_url: string | null }
type Membership = {
  member_id: string
  role: string
  status: string
  display_in_org: boolean
  members: MemberView | MemberView[] | null
}
type Org = {
  id: string
  name: string
  type: string
  description: string | null
  public_flag: boolean
  inzai_registration_number?: string | null
  organization_categories: OrgCategory[] | null
  memberships?: Membership[] | null
}

function pickMember(m: Membership): MemberView | null {
  if (!m.members) return null
  return Array.isArray(m.members) ? (m.members[0] ?? null) : m.members
}

const ROLE_LABEL: Record<string, string> = {
  representative: '代表',
  officer: '役員',
  member: '会員',
}

export default function OrgsBrowser({ orgs }: { orgs: Org[] }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [openOrg, setOpenOrg] = useState<Org | null>(null)

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
        const hay = `${o.name} ${o.description ?? ''} ${o.inzai_registration_number ?? ''}`.toLowerCase()
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
          placeholder="団体名・説明文・登録番号で検索"
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
            const visibleMembers = (o.memberships ?? []).filter((m) => m.display_in_org)
            const preview = visibleMembers.slice(0, MEMBERS_PREVIEW)
            const overflow = visibleMembers.length - preview.length
            return (
              <li key={o.id}>
                <div className="flex h-full flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-slate-400 dark:hover:border-slate-600 transition">
                  <Link href={`/orgs/${o.id}`} className="block">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h2 className="text-base font-semibold leading-snug">{o.name}</h2>
                      <span className="shrink-0 text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                        {TYPE_LABEL[o.type] ?? o.type}
                      </span>
                    </div>
                    {o.type === 'civic' && o.inzai_registration_number && (
                      <div className="mb-2">
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-mono">
                          印西市登録 {o.inzai_registration_number}
                        </span>
                      </div>
                    )}
                    {o.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 mb-3">{o.description}</p>
                    )}
                    {cats.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
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

                  {visibleMembers.length > 0 && (
                    <div className="mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2 flex-wrap">
                        {preview.map((m) => {
                          const mv = pickMember(m)
                          if (!mv) return null
                          return (
                            <MemberChip key={m.member_id} name={mv.display_name} avatar={mv.avatar_url} />
                          )
                        })}
                        {overflow > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenOrg(o)}
                            className="text-[10px] px-2 py-1 rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            ほか {overflow} 名
                          </button>
                        )}
                        {overflow === 0 && visibleMembers.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenOrg(o)}
                            className="text-[10px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline"
                          >
                            一覧
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {openOrg && <MembersModal org={openOrg} onClose={() => setOpenOrg(null)} />}
    </div>
  )
}

function MemberChip({ name, avatar }: { name: string; avatar: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 pr-2 pl-0.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] max-w-[140px]"
      title={name}
    >
      <Avatar src={avatar} name={name} size="xs" className="border-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}

function MembersModal({ org, onClose }: { org: Org; onClose: () => void }) {
  const members = (org.memberships ?? [])
    .filter((m) => m.display_in_org)
    .map((m) => ({ ...m, view: pickMember(m) }))
    .filter((m) => m.view !== null)

  // role 順: representative → officer → member
  const roleRank = (r: string) => (r === 'representative' ? 0 : r === 'officer' ? 1 : 2)
  members.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.view!.display_name.localeCompare(b.view!.display_name, 'ja'))

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{org.name}</h2>
            <p className="text-xs text-slate-500">メンバー {members.length} 名</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <ul className="overflow-y-auto p-2 divide-y divide-slate-100 dark:divide-slate-800">
          {members.length === 0 && (
            <li className="text-sm text-slate-400 text-center py-8">表示可能なメンバーがいません</li>
          )}
          {members.map((m) => (
            <li key={m.member_id} className="flex items-center gap-3 px-2 py-2">
              <Avatar src={m.view!.avatar_url} name={m.view!.display_name} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.view!.display_name}</div>
                <div className="text-[10px] text-slate-500">{ROLE_LABEL[m.role] ?? m.role}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-right">
          <Link
            href={`/orgs/${org.id}`}
            className="text-xs text-slate-600 dark:text-slate-300 hover:underline"
          >
            団体ページを開く →
          </Link>
        </div>
      </div>
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
