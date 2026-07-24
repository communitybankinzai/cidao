import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const RESIDENCY_LABEL: Record<string, string> = {
  citizen: '市民',
  related_population: '関係人口',
}

export default async function AdminMembersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { data: members } = await supabase
    .from('members')
    .select('id, display_name, tier, residency_type, admin_role, created_at, last_active_at, member_private(real_name)')
    .in('tier', ['email_only', 'verified'])
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  type Row = {
    id: string
    display_name: string
    tier: string
    residency_type: string | null
    admin_role: string | null
    created_at: string
    last_active_at: string | null
    member_private: { real_name: string | null } | { real_name: string | null }[] | null
  }
  const rows = (members ?? []) as Row[]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
          <Link href="/admin/members/light" className="hover:underline">ライトユーザー一覧 →</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">メンバー一覧（本登録済み）</h1>
          <p className="text-xs text-slate-500">
            メール確認済み・住所確認済み（本登録）の会員 {rows.length} 名。LINE登録のみの「ライト」会員は別画面。
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
                  <th className="p-3">実名</th>
                  <th className="p-3">状態</th>
                  <th className="p-3">居住区分</th>
                  <th className="p-3">権限</th>
                  <th className="p-3">登録日</th>
                  <th className="p-3">最終アクティブ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const priv = Array.isArray(m.member_private) ? m.member_private[0] : m.member_private
                  return (
                    <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <td className="p-3 font-medium">{m.display_name}</td>
                      <td className="p-3 text-slate-500">{priv?.real_name ?? '—'}</td>
                      <td className="p-3">
                        <span className={
                          'px-1.5 py-0.5 rounded text-[10px] font-semibold ' +
                          (m.tier === 'verified'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200')
                        }>
                          {m.tier === 'verified' ? '本登録済み' : 'メール確認済み'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500">{RESIDENCY_LABEL[m.residency_type ?? ''] ?? '—'}</td>
                      <td className="p-3 text-slate-500">{m.admin_role ?? '—'}</td>
                      <td className="p-3 text-slate-500">{new Date(m.created_at).toLocaleDateString('ja-JP')}</td>
                      <td className="p-3 text-slate-500">{m.last_active_at ? new Date(m.last_active_at).toLocaleDateString('ja-JP') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
