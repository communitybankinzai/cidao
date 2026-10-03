import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { REGIONS } from '@/lib/freefree-import-core'
import OpenpoiImportManager, { type CandidateRow, type RunRow, type Stats } from './_components/OpenpoiImportManager'

export const dynamic = 'force-dynamic'
// 取得は最大40秒（OpenPOI を区画ごとに叩く）。Server Action にもこの上限が適用される
export const maxDuration = 60

const PAGE_SIZE = 50

type SP = { status?: string; dup?: string; cat?: string; q?: string; page?: string }

const STATUSES = ['candidate', 'imported', 'excluded', 'failed', 'publishing'] as const

export default async function OpenpoiImportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/freefree/openpoi')
  const { data: me } = await supabase.from('members').select('admin_role').eq('id', user.id).maybeSingle()
  const role = me?.admin_role as string | null | undefined
  if (role !== 'committee' && role !== 'super') redirect('/')

  const status = sp.status && (['all', ...STATUSES] as string[]).includes(sp.status) ? sp.status : 'candidate'
  const dup = ['all', 'flagged', 'duplicate', 'possible', 'none'].includes(sp.dup ?? '') ? sp.dup! : 'all'
  const cat = sp.cat || 'all'
  const q = (sp.q ?? '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 60)
  const page = Math.max(0, Number.parseInt(sp.page ?? '0', 10) || 0)

  let query = supabase
    .from('freefree_import_candidates')
    .select(
      'id, source, name, name_kana, prefecture, city, address, latitude, longitude, openpoi_category, business_type, openpoi_source, phone, website, opening_hours, description, licenses, attributions, category, category_reason, import_status, duplicate_status, duplicate_reason, duplicate_of_post_id, duplicate_of_candidate_id, freefree_post_id, import_error, edits, edited, update_available, update_diff, last_seen_at, raw_data',
      { count: 'exact' },
    )
  if (status !== 'all') query = query.eq('import_status', status)
  if (dup === 'flagged') query = query.in('duplicate_status', ['duplicate', 'possible'])
  else if (dup !== 'all') query = query.eq('duplicate_status', dup)
  if (cat === 'uncat') query = query.is('category', null)
  else if (cat !== 'all') query = query.eq('category', cat)
  if (q) query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%`)
  const { data: rows, count, error } = await query
    .order('name_kana', { ascending: true, nullsFirst: false })
    .order('name')
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  // 登録済みの行は、掲載がいま公開されているかも見せる（お店が登録して自動で非公開になったものが分かるように）
  const postIds = (rows ?? []).map((r) => r.freefree_post_id).filter((v): v is string => !!v)
  const postStatus = new Map<string, string>()
  if (postIds.length > 0) {
    const { data: ps } = await supabase.from('freefree_posts').select('id, status').in('id', postIds)
    for (const p of ps ?? []) postStatus.set(p.id, p.status)
  }

  const tableMissing = !!error && /relation .*freefree_import|could not find the table|schema cache/i.test(error.message)

  // 件数サマリ（全体）
  const stats: Stats = { total: 0, candidate: 0, imported: 0, excluded: 0, failed: 0, publishing: 0, duplicate: 0, possible: 0, uncategorized: 0, updates: 0 }
  if (!error) {
    // PostgREST は1回の取得を1000行までに制限するため、行を取って数えず件数だけを問い合わせる
    const count = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
      const { count: n } = await apply(base())
      return n ?? 0
    }
    const base = () => supabase.from('freefree_import_candidates').select('id', { count: 'exact', head: true })
    const [candidate, imported, excluded, failed, publishing, duplicate, possible, uncategorized, updates] = await Promise.all([
      count((q) => q.eq('import_status', 'candidate')),
      count((q) => q.eq('import_status', 'imported')),
      count((q) => q.eq('import_status', 'excluded')),
      count((q) => q.eq('import_status', 'failed')),
      count((q) => q.eq('import_status', 'publishing')),
      count((q) => q.eq('import_status', 'candidate').eq('duplicate_status', 'duplicate')),
      count((q) => q.eq('import_status', 'candidate').eq('duplicate_status', 'possible')),
      count((q) => q.eq('import_status', 'candidate').is('category', null)),
      count((q) => q.eq('update_available', true)),
    ])
    Object.assign(stats, { candidate, imported, excluded, failed, publishing, duplicate, possible, uncategorized, updates })
    stats.total = candidate + imported + excluded + failed + publishing
  }

  const { data: runs } = await supabase
    .from('freefree_import_runs')
    .select('id, kind, region_key, status, counts, error, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(8)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/admin" className="hover:underline">← 管理画面</Link>
          <span className="mx-2">/</span>
          <Link href="/admin/freefree" className="hover:underline">FreeFree掲示板の管理</Link>
        </nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-2xl md:text-3xl font-serif font-bold">OpenPOIインポート管理</h1>
          <p className="text-sm text-slate-500 mt-1">
            OpenPOI API から地域の店舗・施設を取り込み、確認してから FreeFree に登録します。取得した施設は<strong>まず「候補」に保存され、運営が選んだものだけ</strong>が公開されます。
          </p>
        </header>

        {tableMissing ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
            テーブルが未作成です。Supabase に <code>supabase/migrations/20261002100000_freefree_openpoi_import.sql</code> を適用してください。
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-200">読み込みに失敗しました: {error.message}</div>
        ) : (
          <OpenpoiImportManager
            rows={((rows ?? []) as CandidateRow[]).map((r) => ({ ...r, post_status: r.freefree_post_id ? postStatus.get(r.freefree_post_id) ?? null : null }))}
            totalCount={count ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            filters={{ status, dup, cat, q }}
            stats={stats}
            runs={(runs ?? []) as RunRow[]}
            defaultRegion={{ prefecture: REGIONS[0].prefecture, city: REGIONS[0].city }}
          />
        )}
      </div>
    </div>
  )
}
