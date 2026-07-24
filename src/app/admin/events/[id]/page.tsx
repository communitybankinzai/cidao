import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const ROLE_LABEL: Record<string, string> = {
  organizer: '主催者',
  staff: 'スタッフ',
  participant: '参加者',
}

export default async function AdminEventParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { data: event } = await supabase.from('events').select('id, title, start_at').eq('id', id).single()
  if (!event) notFound()

  const { data: participants } = await supabase
    .from('event_participants')
    .select('member_id, role, attended, joined_at, members(display_name)')
    .eq('event_id', id)
    .order('joined_at', { ascending: true })

  type Row = {
    member_id: string
    role: string
    attended: boolean
    joined_at: string
    members: { display_name: string } | { display_name: string }[] | null
  }
  const rows = (participants ?? []) as Row[]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
          <Link href="/admin/events" className="hover:underline">← イベント参加者一覧</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">{event.title}</h1>
          <p className="text-xs text-slate-500">
            {new Date(event.start_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} ／ 参加者 {rows.length} 名
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="text-slate-400 text-center py-12">参加者はまだいません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="p-3">表示名</th>
                  <th className="p-3">役割</th>
                  <th className="p-3">出欠</th>
                  <th className="p-3">参加登録日</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const mem = Array.isArray(p.members) ? p.members[0] : p.members
                  return (
                    <tr key={p.member_id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <td className="p-3 font-medium">{mem?.display_name ?? '（名前未設定）'}</td>
                      <td className="p-3 text-slate-500">{ROLE_LABEL[p.role] ?? p.role}</td>
                      <td className="p-3">
                        {p.attended ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">出席</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800">未記録</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-500">{new Date(p.joined_at).toLocaleDateString('ja-JP')}</td>
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
