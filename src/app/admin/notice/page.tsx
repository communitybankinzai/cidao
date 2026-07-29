import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import NoticeForm from './_components/NoticeForm'

export const dynamic = 'force-dynamic'

type Broadcast = {
  broadcast_id: string
  kind: string
  title: string
  body: string | null
  link_url: string | null
  sent_at: string
  recipients: number
  read_count: number
}

const KIND_LABEL: Record<string, string> = {
  system: '📣 一斉お知らせ',
  event: '📅 イベント',
  freefree: '🛍 FreeFree',
  proposal: '🗳 提案',
  member: '🙋 メンバー',
  org: '👥 団体',
}

function formatJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function AdminNoticePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/notice')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect('/')

  // 送信履歴（notification_broadcasts）と宛先数は他人宛の行を含むため service_role で読む
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  let broadcasts: Broadcast[] = []
  let memberCount = 0
  let configured = false

  if (supaUrl && serviceKey) {
    configured = true
    const admin = createSupabaseClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const [{ data: rows }, { count }] = await Promise.all([
      admin
        .from('notification_broadcasts')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(50),
      admin
        .from('members')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null),
    ])
    broadcasts = (rows ?? []) as Broadcast[]
    memberCount = count ?? 0
  }

  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">← 管理メニュー</Link>
        <h1 className="text-2xl font-bold mt-2">お知らせ配信</h1>
        <p className="text-sm text-slate-500 mt-1">
          全体に関わる出来事（新着イベント・FreeFree掲載・新規提案・メンバー本登録・団体の登録/更新）は
          自動でベル🔔とWebプッシュに配信されます。ここでは、それ以外の連絡を手動で一斉配信できます。
        </p>
      </div>

      {!configured ? (
        <p className="text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-300 rounded p-3">
          SUPABASE_SERVICE_ROLE_KEY が未設定のため配信できません。環境変数を設定してください。
        </p>
      ) : (
        <NoticeForm memberCount={memberCount} />
      )}

      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold">🗂 配信履歴（直近50件）</h2>
        {broadcasts.length === 0 ? (
          <p className="text-sm text-slate-500">まだ全体配信はありません。</p>
        ) : (
          <ul className="divide-y">
            {broadcasts.map((b) => (
              <li key={b.broadcast_id} className="py-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{KIND_LABEL[b.kind] ?? b.kind}</span>
                  <span>{formatJst(b.sent_at)}</span>
                  <span>
                    {b.recipients}人に配信 / 既読 {b.read_count}人
                  </span>
                </div>
                <div className="text-sm font-medium">{b.title}</div>
                {b.body && <div className="text-sm text-slate-600 dark:text-slate-400">{b.body}</div>}
                {b.link_url && (
                  <Link href={b.link_url} className="text-xs text-blue-600 hover:underline">
                    {b.link_url}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
