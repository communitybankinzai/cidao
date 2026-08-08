import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

// 書き込み操作の記録（IPアドレス付き）。悪質投稿への対応で発信者を辿るために使う。
// 90日を超えた行は pg_cron（cidao_audit_cleanup）が毎日削除する。

const ACTION_LABEL: Record<string, string> = {
  'freefree.create': '🛍 FreeFree掲載',
  'freefree.comment': '💬 応援コメント',
  'freefree.like': '👏 応援',
  'event.create': '📅 イベント登録',
  'proposal.create': '📝 提案',
  'message.send': '✉️ メッセージ送信',
  'org.create': '👥 団体登録',
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/audit')

  const { data: me } = await supabase.from('members').select('admin_role').eq('id', user.id).maybeSingle()
  const role = me?.admin_role as string | null | undefined
  if (role !== 'committee' && role !== 'super') redirect('/')

  const { q } = await searchParams
  const keyword = (q ?? '').trim()

  let query = supabase
    .from('audit_logs')
    .select('id, actor_type, actor_id, action, target_type, target_id, detail, ip, user_agent, timestamp')
    .order('timestamp', { ascending: false })
    .limit(300)
  // IPで絞り込めると「同じ回線からの繰り返し」を追える
  if (keyword) query = query.eq('ip', keyword)

  const { data: logs, error } = await query

  const actorIds = Array.from(new Set((logs ?? []).map((l) => l.actor_id).filter(Boolean) as string[]))
  const names = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: ms } = await supabase.from('members').select('id, display_name').in('id', actorIds)
    ;(ms ?? []).forEach((m) => names.set(m.id, m.display_name))
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/admin" className="hover:underline">← 管理画面</Link></nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin / Audit</p>
          <h1 className="text-3xl font-serif font-bold">書き込み記録（IPアドレス）</h1>
          <p className="text-sm text-slate-500 mt-1">
            他の人の目に触れる内容を作る操作を記録しています。閲覧だけの利用は記録していません。
          </p>
        </header>

        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <p>⚠ <strong>90日を超えた記録は毎日自動で削除されます。</strong>必要な記録は期限内に取り出してください。</p>
          <p>⚠ <strong>投票は記録していません。</strong>投票の秘密を守るため、誰がどの提案に投票したかは運営にも分からない設計です。提案への支援メッセージも同じ理由で記録対象外です。</p>
          <p>⚠ 第三者（警察を含む）への提供は法令に基づく手続きが必要です。運用ルールは法務確認のうえ定めてください。</p>
        </div>

        <form className="flex gap-2" action="/admin/audit">
          <input
            name="q"
            defaultValue={keyword}
            placeholder="IPアドレスで絞り込む（例: 203.0.113.45）"
            className="flex-1 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5"
          />
          <button type="submit" className="text-sm px-4 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
            絞り込む
          </button>
          {keyword && (
            <Link href="/admin/audit" className="text-sm px-4 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
              解除
            </Link>
          )}
        </form>

        {error && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg p-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">記録を読み込めませんでした</p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              マイグレーション <code>20260808150000_audit_ip_logging.sql</code> が未適用の可能性があります。
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-mono break-all mt-1">{error.message}</p>
          </div>
        )}

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-3">最近の書き込み（{(logs ?? []).length} 件／最大300件）</h2>
          {(logs ?? []).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-1.5 pr-3 whitespace-nowrap">日時</th>
                    <th className="py-1.5 pr-3 whitespace-nowrap">操作</th>
                    <th className="py-1.5 pr-3 whitespace-nowrap">実行者</th>
                    <th className="py-1.5 pr-3 whitespace-nowrap">IPアドレス</th>
                    <th className="py-1.5">端末</th>
                  </tr>
                </thead>
                <tbody>
                  {(logs ?? []).map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 dark:border-slate-800/60 align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">
                        {new Date(l.timestamp).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{ACTION_LABEL[l.action] ?? l.action}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{l.actor_id ? (names.get(l.actor_id) ?? l.actor_id.slice(0, 8)) : '—'}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap font-mono">
                        {l.ip ? (
                          <Link href={`/admin/audit?q=${encodeURIComponent(String(l.ip))}`} className="hover:underline">{String(l.ip)}</Link>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-1.5 text-slate-400 max-w-[16rem] truncate">{l.user_agent ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">
              {keyword ? 'このIPアドレスの記録はありません' : '記録はまだありません（この機能を有効にした以降の書き込みから記録されます）'}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
