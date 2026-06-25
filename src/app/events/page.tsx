import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { categoryLabel } from '@/lib/categories'

export default async function EventsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: events } = await supabase
    .from('events')
    .select('id, title, category, start_at, end_at, location, online_flag, status, capacity, organizer_type')
    .neq('status', 'draft')
    .gte('end_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(50)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </nav>
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">イベント</h1>
          </div>
          {user && (
            <Link href="/events/new">
              <Button>イベント登録</Button>
            </Link>
          )}
        </header>

        {!events || events.length === 0 ? (
          <p className="text-slate-400 text-center py-12">予定イベントはありません</p>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-slate-400 transition">
                  <div className="flex justify-between mb-1">
                    <h2 className="text-lg font-semibold">{e.title}</h2>
                    <span className="text-xs text-slate-500">
                      {new Date(e.start_at).toLocaleDateString('ja-JP')} {new Date(e.start_at).toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'})}
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs flex-wrap">
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(e.category)}</span>
                    {e.online_flag && <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900 rounded">オンライン</span>}
                    {e.location && <span className="text-slate-500">📍 {e.location}</span>}
                    {e.capacity && <span className="text-slate-500">定員 {e.capacity}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
