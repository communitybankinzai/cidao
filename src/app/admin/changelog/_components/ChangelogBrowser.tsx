'use client'

import { useMemo, useState } from 'react'
import { AGENTS, agentById, type Agent } from '@/lib/agents'

const TYPE_STYLES: Record<string, string> = {
  feat:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  fix:      'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  refactor: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  perf:     'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  docs:     'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  chore:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  test:     'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  style:    'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
  ci:       'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  build:    'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
  revert:   'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
}

export type ChangelogCommit = {
  sha: string
  shortSha: string
  url: string
  date: string
  authorName: string
  authorLogin: string | null
  avatarUrl: string | null
  type: string | null
  scope: string | null
  subject: string
  body: string
  agentId: string
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function ChangelogBrowser({ commits }: { commits: ChangelogCommit[] }) {
  const [agentFilter, setAgentFilter] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const x of commits) c[x.agentId] = (c[x.agentId] ?? 0) + 1
    return c
  }, [commits])

  const filtered = useMemo(
    () => (agentFilter ? commits.filter((c) => c.agentId === agentFilter) : commits),
    [commits, agentFilter],
  )

  const activeAgent: Agent | null = agentFilter ? agentById(agentFilter) ?? null : null

  const groups = useMemo(() => {
    const g = new Map<string, ChangelogCommit[]>()
    for (const c of filtered) {
      const k = dayKey(c.date)
      const arr = g.get(k) ?? []
      arr.push(c)
      g.set(k, arr)
    }
    return g
  }, [filtered])

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={agentFilter === null} onClick={() => setAgentFilter(null)}>
            すべてのエージェント <span className="text-slate-400">{commits.length}</span>
          </FilterChip>
          {AGENTS.map((a) => {
            const n = counts[a.id] ?? 0
            const active = agentFilter === a.id
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgentFilter(active ? null : a.id)}
                className={
                  'text-xs px-2 py-1 rounded-full border transition flex items-center gap-1 ' +
                  (active
                    ? 'border-slate-900 dark:border-slate-100 ring-2 ring-slate-300 dark:ring-slate-600'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500') +
                  (n === 0 ? ' opacity-50' : '')
                }
              >
                <span className={`text-[10px] px-1 py-px rounded font-semibold ${a.color}`}>{a.id}</span>
                <span>{a.codename}</span>
                <span className="text-slate-400">{n}</span>
              </button>
            )
          })}
        </div>

        {activeAgent && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 text-xs space-y-1">
            <div className="flex items-baseline gap-2">
              <span className={`px-1.5 py-0.5 rounded font-semibold ${activeAgent.color}`}>{activeAgent.id}</span>
              <span className="font-semibold text-sm">{activeAgent.codename}</span>
              <span className="text-slate-500">{activeAgent.role}</span>
            </div>
            <div className="text-slate-500">担当パートナー: {activeAgent.partner}</div>
            <div className="text-slate-500">担当領域: {activeAgent.scopeDesc}</div>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500">
        {filtered.length} / {commits.length} 件
      </div>

      {filtered.length === 0 ? (
        <p className="text-slate-400 text-center py-12">該当するコミットはありません</p>
      ) : (
        <div className="space-y-8">
          {Array.from(groups.entries()).map(([day, list]) => (
            <section key={day} className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-500 tracking-wider sticky top-0 bg-slate-50 dark:bg-slate-950 py-1">
                {day}
              </h2>
              <ul className="space-y-2">
                {list.map((c) => {
                  const agent = agentById(c.agentId)
                  const typeBadge = c.type ? TYPE_STYLES[c.type] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' : null
                  return (
                    <li key={c.sha} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        {c.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatarUrl} alt="" className="h-8 w-8 rounded-full shrink-0" />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {agent && (
                              <button
                                type="button"
                                onClick={() => setAgentFilter(agent.id)}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${agent.color} hover:opacity-80`}
                                title={`${agent.codename} - ${agent.role}（クリックで絞り込み）`}
                              >
                                {agent.id} {agent.codename}
                              </button>
                            )}
                            {c.type && typeBadge && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${typeBadge}`}>{c.type}</span>
                            )}
                            {c.scope && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                {c.scope}
                              </span>
                            )}
                            <h3 className="text-sm font-medium leading-snug break-words">{c.subject}</h3>
                          </div>
                          {c.body && (
                            <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-400 font-sans">{c.body}</pre>
                          )}
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                            <span>{c.authorLogin ?? c.authorName}</span>
                            <span>{new Date(c.date).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
                            <a href={c.url} target="_blank" rel="noreferrer noopener" className="hover:underline font-mono">{c.shortSha}</a>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
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
