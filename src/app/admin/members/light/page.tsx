import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const RESIDENCY_LABEL: Record<string, string> = {
  citizen: '市民',
  related_population: '関係人口',
}

export default async function AdminMembersLightPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { data: members } = await supabase
    .from('members')
    .select('id, display_name, residency_type, created_at, last_active_at')
    .eq('tier', 'light')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  type Row = {
    id: string
    display_name: string
    residency_type: string | null
    created_at: string
    last_active_at: string | null
  }
  const rows = (members ?? []) as Row[]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
          <Link href="/admin/members" className="hover:underline">← メンバー一覧（本登録済み）</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">メンバー一覧（ライト）</h1>
          <p className="text-xs text-slate-500">
            LINEログインのみで自動作成された「ライト」会員 {rows.length} 名（メール確認・住所確認は未実施）。実名は保持していません。
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="text-slate-400 text-center py-12">該当する会員はいません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="p-3">表示名</th>
                  <th className="p-3">居住区分</th>
                  <th className="p-3">登録日</th>
                  <th className="p-3">最終アクティブ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="p-3 font-medium">{m.display_name}</td>
                    <td className="p-3 text-slate-500">{RESIDENCY_LABEL[m.residency_type ?? ''] ?? '—'}</td>
                    <td className="p-3 text-slate-500">{new Date(m.created_at).toLocaleDateString('ja-JP')}</td>
                    <td className="p-3 text-slate-500">{m.last_active_at ? new Date(m.last_active_at).toLocaleDateString('ja-JP') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
