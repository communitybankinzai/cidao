'use client'

import { useMemo, useState } from 'react'
import { TYPE_LABEL } from '@/lib/org-labels'

export type OrgOption = {
  id: string
  name: string
  type: string
}

export type Selection = {
  org_id: string
  as_representative: boolean
}

export default function OrgClaimPicker({
  orgs,
  alreadyJoinedIds,
  initial,
}: {
  orgs: OrgOption[]
  alreadyJoinedIds: string[]
  initial: Selection[]
}) {
  const joined = useMemo(() => new Set(alreadyJoinedIds), [alreadyJoinedIds])
  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])

  const [selections, setSelections] = useState<Selection[]>(initial)
  const [query, setQuery] = useState('')

  const selectedIds = useMemo(() => new Set(selections.map((s) => s.org_id)), [selections])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return orgs
      .filter((o) => !joined.has(o.id) && !selectedIds.has(o.id))
      .filter((o) => o.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [orgs, joined, selectedIds, query])

  function add(id: string) {
    setSelections((prev) => [...prev, { org_id: id, as_representative: false }])
    setQuery('')
  }

  function remove(id: string) {
    setSelections((prev) => prev.filter((s) => s.org_id !== id))
  }

  function toggleRep(id: string) {
    setSelections((prev) =>
      prev.map((s) => (s.org_id === id ? { ...s, as_representative: !s.as_representative } : s)),
    )
  }

  return (
    <div className="space-y-3">
      <input
        type="hidden"
        name="org_claims"
        value={JSON.stringify(selections)}
      />

      <div className="space-y-1.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="団体名で検索（例: ボーイスカウト、亀成川、印西少年）"
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        />
        {candidates.length > 0 && (
          <ul className="border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
            {candidates.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => add(o.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-between"
                >
                  <span>{o.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                    {TYPE_LABEL[o.type] ?? o.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && candidates.length === 0 && (
          <p className="text-xs text-slate-500">
            該当する団体がありません。一覧にない団体は{' '}
            <a href="/orgs/new" className="underline">/orgs/new</a> で新規登録できます。
          </p>
        )}
      </div>

      {selections.length === 0 ? (
        <p className="text-xs text-slate-500">
          所属している印西の団体があれば検索して追加してください。承認は管理者または団体代表者が行います。
        </p>
      ) : (
        <ul className="space-y-2">
          {selections.map((s) => {
            const org = orgById.get(s.org_id)
            if (!org) return null
            return (
              <li
                key={s.org_id}
                className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{org.name}</div>
                    <div className="text-[10px] text-slate-500">{TYPE_LABEL[org.type] ?? org.type}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(s.org_id)}
                    className="text-xs text-slate-500 hover:text-rose-600 underline"
                  >
                    取消
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={s.as_representative}
                    onChange={() => toggleRep(s.org_id)}
                  />
                  <span>
                    私がこの団体の<strong>代表者</strong>です
                    <span className="block text-[10px] text-slate-500">
                      代表者として申告する場合、管理者の承認が必要です（虚偽申告防止）
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
