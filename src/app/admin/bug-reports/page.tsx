import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { updateBugReportStatus } from './actions'

const STATUS_LABEL: Record<string, string> = {
  open: '未対応',
  in_progress: '対応中',
  resolved: '解決済み',
  closed: 'クローズ',
}
const CATEGORY_LABEL: Record<string, string> = {
  bug: '不具合',
  feature_request: '要望',
  other: 'その他',
}
const SOURCE_LABEL: Record<string, string> = {
  cbi_site: 'CBIサイト',
  cidao_app: 'CiDAOアプリ',
}
const STATUSES = ['open', 'in_progress', 'resolved', 'closed']

export default async function AdminBugReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { data: reports } = await supabase
    .from('bug_reports')
    .select('id, source, category, description, page_url, reporter_name, reporter_email, status, admin_note, created_at')
    .order('created_at', { ascending: false })

  type Row = NonNullable<typeof reports>[number]
  const rows = (reports ?? []) as Row[]

  async function handleUpdate(formData: FormData) {
    'use server'
    const id = String(formData.get('id') ?? '')
    const status = String(formData.get('status') ?? '')
    const adminNote = String(formData.get('admin_note') ?? '')
    if (id && status) await updateBugReportStatus(id, status, adminNote)
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
          <h1 className="text-3xl font-serif font-bold">不具合・要望レポート</h1>
          <p className="text-xs text-slate-500">
            CBIサイト・CiDAOアプリから寄せられた報告一覧（/bug-report からの投稿）。ステータスとメモを更新できます。
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="text-slate-400 text-center py-12">報告はまだありません</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3"
              >
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {SOURCE_LABEL[r.source] ?? r.source}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200 font-semibold">
                    {CATEGORY_LABEL[r.category] ?? r.category}
                  </span>
                  <span
                    className={
                      'px-1.5 py-0.5 rounded font-semibold ' +
                      (r.status === 'open'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                        : r.status === 'in_progress'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200')
                    }
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                    {new Date(r.created_at).toLocaleString('ja-JP')}
                  </span>
                </div>

                <p className="text-sm whitespace-pre-wrap">{r.description}</p>

                <div className="text-[11px] text-slate-500 space-y-0.5">
                  {r.page_url && <p>ページ: {r.page_url}</p>}
                  <p>
                    報告者: {r.reporter_name ?? '(未入力)'}
                    {r.reporter_email ? ` / ${r.reporter_email}` : ''}
                  </p>
                </div>

                <form action={handleUpdate} className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-slate-500 block">ステータス</label>
                    <select
                      name="status"
                      defaultValue={r.status}
                      className="text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px] space-y-0.5">
                    <label className="text-[10px] text-slate-500 block">対応メモ</label>
                    <input
                      type="text"
                      name="admin_note"
                      defaultValue={r.admin_note ?? ''}
                      className="w-full text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1"
                    />
                  </div>
                  <Button type="submit" size="sm">更新</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
