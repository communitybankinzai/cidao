import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { registerOrgCandidate, excludeOrgCandidate, undoExcludeOrgCandidate } from './actions'

export const dynamic = 'force-dynamic'

type Candidate = {
  name: string
  eventCount: number
  sampleTitles: string[]
}

export default async function AdminOrgCandidatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const [{ data: events }, { data: orgs }, { data: exclusions }] = await Promise.all([
    supabase
      .from('events')
      .select('title, organizer_name_text, start_at')
      .not('organizer_name_text', 'is', null)
      .order('start_at', { ascending: false }),
    supabase.from('organizations').select('name'),
    supabase.from('org_name_exclusions').select('name, reason, excluded_at'),
  ])

  const registered = new Set((orgs ?? []).map((o) => o.name.trim()))
  const excluded = new Map((exclusions ?? []).map((e) => [e.name, e]))

  const byName = new Map<string, Candidate>()
  for (const e of events ?? []) {
    const name = (e.organizer_name_text ?? '').trim()
    if (!name || registered.has(name) || excluded.has(name)) continue
    const c: Candidate = byName.get(name) ?? { name, eventCount: 0, sampleTitles: [] }
    c.eventCount += 1
    if (c.sampleTitles.length < 2) c.sampleTitles.push(e.title)
    byName.set(name, c)
  }
  const candidates = [...byName.values()].sort((a, b) => b.eventCount - a.eventCount)

  async function handleRegister(formData: FormData) {
    'use server'
    const name = String(formData.get('name') ?? '')
    if (name) await registerOrgCandidate(name)
  }

  async function handleExclude(formData: FormData) {
    'use server'
    const name = String(formData.get('name') ?? '')
    const reason = String(formData.get('reason') ?? '')
    if (name) await excludeOrgCandidate(name, reason)
  }

  async function handleUndo(formData: FormData) {
    'use server'
    const name = String(formData.get('name') ?? '')
    if (name) await undoExcludeOrgCandidate(name)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">団体候補</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            イベントの主催者名のうち、まだ団体として登録されていないものです。
            市民活動団体だと判断できるものだけ「団体として登録」してください。
            登録すると代表者が空のままの暫定ページができ、団体ページには「代表者による更新待ち」が表示されます。
            企業・行政・広報紙名など団体でないものは「除外」を選ぶと、次回からこの一覧に出なくなります。
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            未処理の候補（{candidates.length}件）
          </h2>
          {candidates.length === 0 && (
            <p className="text-sm text-slate-500 bg-white dark:bg-slate-900 border rounded-lg p-6">
              未処理の候補はありません。
            </p>
          )}
          {candidates.map((c) => (
            <div
              key={c.name}
              className="bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-slate-500">イベント {c.eventCount} 件</span>
              </div>
              <ul className="text-xs text-slate-500 list-disc list-inside space-y-0.5">
                {c.sampleTitles.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-slate-100 dark:border-slate-800">
                <form action={handleRegister}>
                  <input type="hidden" name="name" value={c.name} />
                  <Button type="submit" size="sm">団体として登録</Button>
                </form>
                <form action={handleExclude} className="flex gap-1 items-center">
                  <input type="hidden" name="name" value={c.name} />
                  <select
                    name="reason"
                    className="text-xs border rounded px-2 py-1 bg-white dark:bg-slate-900"
                    defaultValue="企業・店舗"
                  >
                    <option value="企業・店舗">企業・店舗</option>
                    <option value="行政・公共機関">行政・公共機関</option>
                    <option value="広報紙・Webサイト等の出典名">広報紙・Webサイト等の出典名</option>
                    <option value="個人">個人</option>
                    <option value="団体名として不明瞭">団体名として不明瞭</option>
                  </select>
                  <Button type="submit" size="sm" variant="secondary">除外</Button>
                </form>
              </div>
            </div>
          ))}
        </section>

        {excluded.size > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">除外済み（{excluded.size}件）</h2>
            <div className="bg-white dark:bg-slate-900 border rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
              {[...excluded.values()].map((e) => (
                <div key={e.name} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-slate-500">{e.reason ?? '—'}</span>
                  <form action={handleUndo} className="ml-auto">
                    <input type="hidden" name="name" value={e.name} />
                    <button type="submit" className="text-slate-500 hover:underline">
                      候補に戻す
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
