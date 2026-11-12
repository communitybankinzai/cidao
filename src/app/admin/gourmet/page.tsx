// 食レポの SNS 巡回の候補（2026-11-13 事業主決定 A案）。運営が承認したお店だけ地図に出る。自動公開はしない
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { CandidateList } from './_components/CandidateList'
import { CrawlSwitch } from './_components/CrawlSwitch'
import type { CandidateRow } from '@/lib/gourmet-candidates'
import { GOURMET_CRAWL_SETTING } from '@/lib/gourmet-crawl'

export const dynamic = 'force-dynamic'

export default async function AdminGourmetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/gourmet')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect('/')

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
  const [{ data: rows }, { data: setting }, { count: doneCount }] = await Promise.all([
    db.from('gourmet_candidates').select('id, source, post_id, post_url, author_handle, posted_at, shops, more_shops, hold_reason, status, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    db.from('app_settings').select('value').eq('key', GOURMET_CRAWL_SETTING).maybeSingle(),
    db.from('gourmet_reports').select('id', { count: 'exact', head: true }).eq('source', 'crawl').eq('hidden', false),
  ])
  const candidates = (rows ?? []) as CandidateRow[]
  const value = (setting?.value as { enabled?: boolean; daily_ai_limit?: number } | null) ?? {}

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/admin" className="hover:underline">← 管理画面</Link></nav>
        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin / Gourmet</p>
          <h1 className="text-3xl font-serif font-bold">食レポの候補（SNS 巡回）</h1>
          <p className="text-sm text-slate-500">
            毎朝の Instagram の取得（#印西 の検索・監視アカウント）から、AI が見つけた食レポの候補です。お店ごとに確かめて「選んだものを承認」すると、
            食レポマップに「巡回で見つけた投稿」として出ます。承認するまで公開されません。批判的なお店と、範囲（印西市＋周辺6市町）の外のお店は、最初から除いています。
          </p>
        </header>
        <CrawlSwitch enabled={value.enabled === true} dailyLimit={value.daily_ai_limit ?? 40} />
        <p className="text-sm text-slate-500">承認待ち {candidates.length} 件・巡回から地図に出ている食レポ {doneCount ?? 0} 件</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500">承認待ちの候補はありません。</p>
        ) : (
          <CandidateList candidates={candidates} />
        )}
      </div>
    </div>
  )
}
