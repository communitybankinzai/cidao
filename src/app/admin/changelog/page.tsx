import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const GITHUB_REPO = 'communitybankinzai/cidao'
const GITHUB_BRANCH = 'main'
const PER_PAGE = 50

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

type GithubCommit = {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
  author: { login: string; avatar_url: string } | null
}

type ParsedCommit = {
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
}

function parseCommit(c: GithubCommit): ParsedCommit {
  const [firstLine, ...rest] = c.commit.message.split('\n')
  const body = rest.join('\n').trim()
  const m = firstLine.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/)
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    url: c.html_url,
    date: c.commit.author.date,
    authorName: c.commit.author.name,
    authorLogin: c.author?.login ?? null,
    avatarUrl: c.author?.avatar_url ?? null,
    type: m ? m[1] : null,
    scope: m ? m[2] ?? null : null,
    subject: m ? m[3] : firstLine,
    body,
  }
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

async function fetchCommits(): Promise<{ commits: ParsedCommit[]; error: string | null }> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?sha=${GITHUB_BRANCH}&per_page=${PER_PAGE}`
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  try {
    const res = await fetch(url, { headers, next: { revalidate: 300 } })
    if (!res.ok) return { commits: [], error: `GitHub API ${res.status}` }
    const data: GithubCommit[] = await res.json()
    return { commits: data.map(parseCommit), error: null }
  } catch (e) {
    return { commits: [], error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

export default async function AdminChangelogPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { commits, error } = await fetchCommits()

  const groups = new Map<string, ParsedCommit[]>()
  for (const c of commits) {
    const k = dayKey(c.date)
    const arr = groups.get(k) ?? []
    arr.push(c)
    groups.set(k, arr)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
            <h1 className="text-3xl font-serif font-bold">更新履歴</h1>
            <p className="text-xs text-slate-500 mt-1">
              GitHub <code className="text-[10px]">{GITHUB_REPO}</code> の <code className="text-[10px]">{GITHUB_BRANCH}</code> ブランチから自動取得
            </p>
          </div>
        </header>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-900 rounded-lg p-4 text-sm text-rose-800 dark:text-rose-200">
            コミット取得に失敗しました: {error}
          </div>
        )}

        {commits.length === 0 && !error && (
          <p className="text-slate-400 text-center py-12">コミットが見つかりません</p>
        )}

        <div className="space-y-8">
          {Array.from(groups.entries()).map(([day, list]) => (
            <section key={day} className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-500 tracking-wider sticky top-0 bg-slate-50 dark:bg-slate-950 py-1">
                {day}
              </h2>
              <ul className="space-y-2">
                {list.map((c) => {
                  const badge = c.type ? TYPE_STYLES[c.type] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' : null
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
                            {c.type && badge && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge}`}>{c.type}</span>
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
      </div>
    </div>
  )
}
