import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { classifyCommit } from '@/lib/agents'
import ChangelogBrowser, { type ChangelogCommit } from './_components/ChangelogBrowser'

const GITHUB_REPO = 'communitybankinzai/cidao'
const GITHUB_BRANCH = 'main'
const PER_PAGE = 50

type GithubCommit = {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
  author: { login: string; avatar_url: string } | null
}

function parseCommit(c: GithubCommit): ChangelogCommit {
  const [firstLine, ...rest] = c.commit.message.split('\n')
  const body = rest.join('\n').trim()
  const m = firstLine.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/)
  const type = m ? m[1] : null
  const scope = m ? m[2] ?? null : null
  const subject = m ? m[3] : firstLine
  const agent = classifyCommit(scope, subject)
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    url: c.html_url,
    date: c.commit.author.date,
    authorName: c.commit.author.name,
    authorLogin: c.author?.login ?? null,
    avatarUrl: c.author?.avatar_url ?? null,
    type,
    scope,
    subject,
    body,
    agentId: agent.id,
  }
}

async function fetchCommits(): Promise<{ commits: ChangelogCommit[]; error: string | null }> {
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">更新履歴</h1>
          <p className="text-xs text-slate-500">
            GitHub <code className="text-[10px]">{GITHUB_REPO}</code> の <code className="text-[10px]">{GITHUB_BRANCH}</code> ブランチから自動取得。
            各コミットはスコープ／キーワードから担当エージェント（A1〜A10）に自動分類される。
          </p>
        </header>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-900 rounded-lg p-4 text-sm text-rose-800 dark:text-rose-200">
            コミット取得に失敗しました: {error}
          </div>
        )}

        {commits.length === 0 && !error ? (
          <p className="text-slate-400 text-center py-12">コミットが見つかりません</p>
        ) : (
          <ChangelogBrowser commits={commits} />
        )}
      </div>
    </div>
  )
}
