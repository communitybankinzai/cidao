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

type NotifRow = { broadcast_id: string | null; recipient_id: string; read_at: string | null }

// 既読の内訳を出す配信の件数。1件あたりメンバー数ぶんの行を読むため上限を設ける
const READ_DETAIL_LIMIT = 20

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
  const readDetail = new Map<string, { read: string[]; unread: string[] }>()

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

    // 誰が読んだかの内訳。直近 READ_DETAIL_LIMIT 件ぶんだけ取る
    // （配信数 × メンバー数の行になるため、履歴50件ぶん全部は引かない）
    const targetIds = broadcasts.slice(0, READ_DETAIL_LIMIT).map((b) => b.broadcast_id)
    if (targetIds.length > 0) {
      const [{ data: notifs }, { data: members }] = await Promise.all([
        admin
          .from('notifications')
          .select('broadcast_id, recipient_id, read_at')
          .in('broadcast_id', targetIds),
        admin.from('members').select('id, display_name'),
      ])
      const nameById = new Map(
        ((members ?? []) as { id: string; display_name: string | null }[]).map((m) => [
          m.id,
          m.display_name ?? '(名前未設定)',
        ]),
      )
      for (const n of (notifs ?? []) as NotifRow[]) {
        if (!n.broadcast_id) continue
        const entry = readDetail.get(n.broadcast_id) ?? { read: [], unread: [] }
        const name = nameById.get(n.recipient_id) ?? '(退会・不明)'
        if (n.read_at) entry.read.push(name)
        else entry.unread.push(name)
        readDetail.set(n.broadcast_id, entry)
      }
      for (const entry of readDetail.values()) {
        entry.read.sort()
        entry.unread.sort()
      }
    }
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
        <p className="text-xs text-slate-500">
          誰が読んだかの内訳は直近{READ_DETAIL_LIMIT}件まで表示します。
          「既読」はベル🔔または通知一覧を開いた時点で付くため、
          一つひとつの本文を読んだことまでは分かりません。
        </p>
        {broadcasts.length === 0 ? (
          <p className="text-sm text-slate-500">まだ全体配信はありません。</p>
        ) : (
          <ul className="divide-y">
            {broadcasts.map((b) => {
              const detail = readDetail.get(b.broadcast_id)
              return (
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

                  {/* 誰が読んだか。運営が個別に声をかける判断のために出す（管理者しか見られない） */}
                  {detail && (
                    <details className="mt-1">
                      <summary className="text-xs text-blue-600 cursor-pointer hover:underline">
                        誰が読んだか見る
                      </summary>
                      <div className="mt-1.5 space-y-1.5 text-xs">
                        <div>
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            既読 {detail.read.length}人
                          </span>
                          <span className="text-slate-600 dark:text-slate-400 ml-2">
                            {detail.read.length > 0 ? detail.read.join('、') : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 font-semibold">
                            未読 {detail.unread.length}人
                          </span>
                          <span className="text-slate-600 dark:text-slate-400 ml-2">
                            {detail.unread.length > 0 ? detail.unread.join('、') : '—'}
                          </span>
                        </div>
                      </div>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
