import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function AdminEventsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { data: events } = await supabase
    .from('events')
    .select('id, title, start_at, status, event_participants(count)')
    .order('start_at', { ascending: false })
    .limit(100)

  type Row = {
    id: string
    title: string
    start_at: string
    status: string
    event_participants: { count: number }[]
  }
  const rows = (events ?? []) as Row[]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">イベント参加者一覧</h1>
          <p className="text-xs text-slate-500">
            直近開催順に最大100件。イベントを選ぶと参加者・出欠状況を確認できます。
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="text-slate-400 text-center py-12">イベントはまだありません</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/admin/events/${e.id}`}
                  className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-slate-400 dark:hover:border-slate-600 transition"
                >
                  <div>
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(e.start_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} ／ {e.status}
                    </p>
                  </div>
                  <span className="text-sm text-slate-500 whitespace-nowrap">参加 {e.event_participants?.[0]?.count ?? 0} 名 →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
