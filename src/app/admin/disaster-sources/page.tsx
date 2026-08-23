import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SOURCE_KINDS } from '@/lib/disaster-timeline'
import DisasterSourcesManager, { type SourceRow } from './_components/DisasterSourcesManager'

export const dynamic = 'force-dynamic'

export default async function AdminDisasterSourcesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/disaster-sources')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect('/')

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const admin = serviceUrl && serviceKey
    ? createSupabaseAdmin(serviceUrl, serviceKey, { auth: { persistSession: false } })
    : null

  let sources: SourceRow[] = []
  let loadError = ''
  let lastRun: { started_at: string; finished_at: string | null; status: string; error_message: string | null } | null = null

  if (!admin) {
    loadError = 'サーバー接続が未設定です（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）'
  } else {
    const [{ data: rows, error }, { data: counts }, { data: run }] = await Promise.all([
      admin
        .from('disaster_info_sources')
        .select('id, kind, label, url, config, trust, enabled, sort_order, last_fetched_at, last_status, last_error')
        .order('sort_order')
        .order('created_at'),
      admin.from('disaster_timeline_items').select('source_id'),
      admin
        .from('disaster_timeline_runs')
        .select('started_at, finished_at, status, error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (error) {
      loadError = /relation .* does not exist|could not find the table|schema cache/i.test(error.message)
        ? 'テーブルが未作成です。Supabase SQL Editor で supabase/migrations/20260823120000_disaster_timeline.sql を実行してください。'
        : error.message
    } else {
      const countBySource = new Map<string, number>()
      for (const row of counts ?? []) {
        countBySource.set(row.source_id, (countBySource.get(row.source_id) ?? 0) + 1)
      }
      sources = (rows ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        label: row.label,
        url: row.url ?? '',
        config: (row.config ?? {}) as Record<string, unknown>,
        trust: row.trust,
        enabled: Boolean(row.enabled),
        lastFetchedAt: row.last_fetched_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
        itemCount: countBySource.get(row.id) ?? 0,
      }))
      lastRun = run ?? null
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/admin" className="hover:underline">← 管理画面</Link>
        </nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">災害タイムライン 情報源</h1>
          <p className="text-sm text-slate-500 mt-2">
            市公式発表・気象庁・市長SNSなどの取得元を登録します。10分ごとに自動巡回し、
            災害MAPは <code className="text-xs">/api/disaster/timeline</code> から読み取ります。
          </p>
        </header>

        {loadError && (
          <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200">
            {loadError}
          </div>
        )}

        <DisasterSourcesManager
          initialSources={sources}
          kinds={SOURCE_KINDS}
          lastRun={lastRun}
          disabled={Boolean(loadError)}
        />
      </div>
    </div>
  )
}
