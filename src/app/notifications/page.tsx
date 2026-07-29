import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { KIND_ICON, KIND_LABEL } from '@/lib/notification-kinds'
import { MarkAllRead } from './_components/MarkAllRead'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  kind: string
  title: string
  body: string | null
  link_url: string | null
  read_at: string | null
  created_at: string
}

function formatJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/notifications')

  // RLS により自分宛（recipient_id = auth.uid()）だけが返る
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link_url, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = (data ?? []) as Row[]
  const hasUnread = rows.some((r) => !r.read_at)

  return (
    <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <MarkAllRead hasUnread={hasUnread} />

      <div>
        <h1 className="text-2xl font-bold">通知</h1>
        <p className="text-sm text-slate-500 mt-1">
          自分宛の通知を新しい順に最大100件表示します。
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 bg-white dark:bg-slate-900 border rounded-lg p-6 text-center">
          通知はまだありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={
                'bg-white dark:bg-slate-900 border rounded-lg p-4 ' +
                (!r.read_at ? 'border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-800')
              }
            >
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span aria-hidden>{KIND_ICON[r.kind] ?? '🔔'}</span>
                <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span>{formatJst(r.created_at)}</span>
                {!r.read_at && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500 text-white">新着</span>
                )}
              </div>

              <p className="text-sm font-medium mt-1.5">{r.title}</p>

              {/* 本文は改行を保ったまま全文表示する */}
              {r.body && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap break-words">
                  {r.body}
                </p>
              )}

              {r.link_url && (
                <Link href={r.link_url} className="inline-block text-xs text-blue-600 hover:underline mt-2">
                  開く →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
