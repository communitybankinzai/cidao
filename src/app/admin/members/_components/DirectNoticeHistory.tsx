// 運営から会員へ1人ずつ送ったお知らせの履歴（直近30件）。誰に・何を・読まれたかを出す。
// 記録は direct_notices（運営だけが読める）。「読まれたか」は notifications.read_at を引く。
// notifications は本人宛ての行しか RLS で読めないため、その分だけサービスロールで読む。
// 「既読」はベル🔔や通知一覧を開いた時点で付くので、本文を読んだことまでは分からない。

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { purposeLabel } from '@/lib/direct-notice'

type Row = {
  id: string
  recipient_id: string
  sent_by: string | null
  purpose: string
  title: string
  body: string | null
  created_at: string
  notification_id: string | null
}

const HISTORY_LIMIT = 30

function formatJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function DirectNoticeHistory() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('direct_notices')
    .select('id, recipient_id, sent_by, purpose, title, body, created_at, notification_id')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (error) {
    return (
      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
        <h2 className="text-lg font-semibold">📨 個別お知らせの履歴</h2>
        <p className="text-sm text-slate-500 mt-2">履歴を読み込めませんでした。時間をおいて開き直してください。</p>
      </section>
    )
  }

  const rows = (data ?? []) as Row[]

  const nameById = new Map<string, string>()
  const readById = new Map<string, boolean>()
  if (rows.length > 0) {
    const personIds = [...new Set(rows.flatMap((r) => [r.recipient_id, r.sent_by].filter((v): v is string => !!v)))]
    const { data: people } = await supabase.from('members').select('id, display_name').in('id', personIds)
    for (const p of (people ?? []) as { id: string; display_name: string | null }[]) {
      nameById.set(p.id, p.display_name ?? '（名前未設定）')
    }

    const notificationIds = rows.map((r) => r.notification_id).filter((v): v is string => !!v)
    const service = createServiceClient()
    if (service && notificationIds.length > 0) {
      const { data: notifs } = await service.from('notifications').select('id, read_at').in('id', notificationIds)
      for (const n of (notifs ?? []) as { id: string; read_at: string | null }[]) {
        readById.set(n.id, n.read_at !== null)
      }
    }
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
      <h2 className="text-lg font-semibold">📨 個別お知らせの履歴（直近{HISTORY_LIMIT}件）</h2>
      <p className="text-xs text-slate-500">
        運営から1人ずつ送ったお知らせです。「既読」はベル🔔や通知一覧を開いた時点で付くため、本文を読んだことまでは分かりません。
        「未読」のままの方には、アプリの外（LINE・お電話など）での声かけが必要です。
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">まだ個別のお知らせはありません。</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const read = r.notification_id ? readById.get(r.notification_id) : undefined
            return (
              <li key={r.id} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span>{formatJst(r.created_at)}</span>
                  <span>
                    宛先：<strong className="text-slate-700 dark:text-slate-300">{nameById.get(r.recipient_id) ?? '（退会・不明）'}</strong>
                  </span>
                  <span>{purposeLabel(r.purpose)}</span>
                  {read === undefined ? (
                    <span>既読：—</span>
                  ) : read ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">既読</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400 font-semibold">未読</span>
                  )}
                  {r.sent_by && <span>送信：{nameById.get(r.sent_by) ?? '（不明）'}</span>}
                </div>
                <div className="text-sm font-medium">{r.title}</div>
                {r.body && (
                  <div className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap line-clamp-3">{r.body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
