'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PROPOSAL_CATEGORIES, categoryLabel } from '@/lib/categories'
import { Avatar } from '@/components/ui/avatar'
import { OrgLogo } from '@/components/ui/org-logo'
import { LEGAL_FORM_LABEL, LEGAL_FORM_ORDER, TYPE_LABEL, TYPE_ORDER } from '@/lib/org-labels'

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
  legal_form?: string | null
  logo_url?: string | null
  description: string | null
  public_flag: boolean
  inzai_registration_number?: string | null
  created_at?: string
  updated_at?: string
  status: OrgStatus
  organization_categories: OrgCategory[] | null
  memberships?: Membership[] | null
}

// 登録状態の3区分（判定はサーバー側 page.tsx で確定済み）。
//   仮登録   … 一括取り込み or AI自動収集で、代表者が未確認
//   新規登録 … ユーザー自身が団体登録フォームから登録
//   更新済み … 代表者が確認・編集済み（info_verified true）
type OrgStatus = 'provisional' | 'self_registered' | 'verified'

const STATUS_LABEL: Record<OrgStatus, string> = {
  provisional: '仮登録',
  self_registered: '新規登録',
  verified: '更新済み',
}

const STATUS_ORDER: OrgStatus[] = ['provisional', 'self_registered', 'verified']

const STATUS_BADGE_CLASS: Record<OrgStatus, string> = {
  provisional: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200',
  self_registered: 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200',
  verified: 'bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-200',
}

type SortKey = 'name' | 'updated' | 'created'

const SORT_LABEL: Record<SortKey, string> = {
  name: '名前順',
  updated: '情報更新順',
  created: '登録順',
}

// 情報更新日の表示用（例: 2026/8/9）。
// サーバー（UTC）とブラウザ（JST）で日付がずれて hydration 不一致にならないよう Asia/Tokyo 固定
function formatDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
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

type RegFilter = 'all' | 'registered' | 'unregistered'

export default function OrgsBrowser({ orgs }: { orgs: Org[] }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [legalFormFilter, setLegalFormFilter] = useState<string | null>(null)
  const [regFilter, setRegFilter] = useState<RegFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<OrgStatus | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [openOrg, setOpenOrg] = useState<Org | null>(null)

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orgs) c[o.type] = (c[o.type] ?? 0) + 1
    return c
  }, [orgs])

  const legalFormCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orgs) {
      if (o.legal_form) c[o.legal_form] = (c[o.legal_form] ?? 0) + 1
    }
    return c
  }, [orgs])

  const regCounts = useMemo(() => {
    let registered = 0
    let unregistered = 0
    for (const o of orgs) {
      if (o.inzai_registration_number) registered++
      else unregistered++
    }
    return { registered, unregistered }
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

  const statusCounts = useMemo(() => {
    const c: Record<OrgStatus, number> = { provisional: 0, self_registered: 0, verified: 0 }
    for (const o of orgs) c[o.status]++
    return c
  }, [orgs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = orgs.filter((o) => {
      if (typeFilter && o.type !== typeFilter) return false
      if (legalFormFilter && o.legal_form !== legalFormFilter) return false
      if (regFilter === 'registered' && !o.inzai_registration_number) return false
      if (regFilter === 'unregistered' && o.inzai_registration_number) return false
      if (categoryFilter && !(o.organization_categories ?? []).some((c) => c.category === categoryFilter)) return false
      if (statusFilter && o.status !== statusFilter) return false
      if (q) {
        const hay = `${o.name} ${o.description ?? ''} ${o.inzai_registration_number ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // 名前順は五十音昇順、情報更新順・登録順は新しい順
    const time = (s?: string | null) => (s ? Date.parse(s) : 0)
    if (sortKey === 'updated') {
      list.sort((a, b) => time(b.updated_at) - time(a.updated_at) || a.name.localeCompare(b.name, 'ja'))
    } else if (sortKey === 'created') {
      list.sort((a, b) => time(b.created_at) - time(a.created_at) || a.name.localeCompare(b.name, 'ja'))
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    }
    return list
  }, [orgs, query, typeFilter, legalFormFilter, regFilter, categoryFilter, statusFilter, sortKey])

  const hasActiveFilter = !!query || !!typeFilter || !!legalFormFilter || regFilter !== 'all' || !!categoryFilter || !!statusFilter

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
            <FilterChip active={regFilter === 'all'} onClick={() => setRegFilter('all')}>
              市登録 不問
            </FilterChip>
            <FilterChip active={regFilter === 'registered'} onClick={() => setRegFilter(regFilter === 'registered' ? 'all' : 'registered')}>
              市登録あり <span className="text-slate-400">{regCounts.registered}</span>
            </FilterChip>
            <FilterChip active={regFilter === 'unregistered'} onClick={() => setRegFilter(regFilter === 'unregistered' ? 'all' : 'unregistered')}>
              市登録なし <span className="text-slate-400">{regCounts.unregistered}</span>
            </FilterChip>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={legalFormFilter === null} onClick={() => setLegalFormFilter(null)}>
              法人格 不問
            </FilterChip>
            {LEGAL_FORM_ORDER.map((lf) => {
              const count = legalFormCounts[lf] ?? 0
              if (!count) return null
              return (
                <FilterChip key={lf} active={legalFormFilter === lf} onClick={() => setLegalFormFilter(legalFormFilter === lf ? null : lf)}>
                  {LEGAL_FORM_LABEL[lf]} <span className="text-slate-400">{count}</span>
                </FilterChip>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={statusFilter === null} onClick={() => setStatusFilter(null)}>
              登録状態 不問
            </FilterChip>
            {STATUS_ORDER.map((s) => {
              const count = statusCounts[s]
              if (!count) return null
              return (
                <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}>
                  {STATUS_LABEL[s]} <span className="text-slate-400">{count}</span>
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

      <div className="text-xs text-slate-500 flex items-center justify-between gap-3 flex-wrap">
        <span>{filtered.length} / {orgs.length} 団体</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">並び替え:</span>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <FilterChip key={k} active={sortKey === k} onClick={() => setSortKey(k)}>
                {SORT_LABEL[k]}
              </FilterChip>
            ))}
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => { setQuery(''); setTypeFilter(null); setLegalFormFilter(null); setRegFilter('all'); setCategoryFilter(null); setStatusFilter(null) }}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
            >
              フィルタを解除
            </button>
          )}
        </div>
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
                    <div className="flex items-start gap-3 mb-2">
                      <OrgLogo src={o.logo_url} name={o.name} size="md" />
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                        <h2 className="text-base font-semibold leading-snug">{o.name}</h2>
                        <span className="shrink-0 text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                          {TYPE_LABEL[o.type] ?? o.type}
                        </span>
                      </div>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-1">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded ${STATUS_BADGE_CLASS[o.status]}`}>
                        {STATUS_LABEL[o.status]}
                      </span>
                      {o.inzai_registration_number && (
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-mono">
                          印西市登録 {o.inzai_registration_number}
                        </span>
                      )}
                      {o.legal_form && (
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {LEGAL_FORM_LABEL[o.legal_form] ?? o.legal_form}
                        </span>
                      )}
                      {o.updated_at && (
                        <span className="inline-block text-[10px] text-slate-400" title="情報更新日">
                          更新 {formatDate(o.updated_at)}
                        </span>
                      )}
                    </div>
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
