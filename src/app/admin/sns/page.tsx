import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SnsActions from './_components/SnsActions'

type NextTarget = {
  target_type: 'freefree' | 'event' | 'org'
  target_id: string
  category: string | null
  last_spotlighted_at: string | null
}

const TARGET_LABEL: Record<string, string> = {
  freefree: '🛍 FreeFree',
  event:    '📅 イベント',
  org:      '👥 団体',
}

const MEDIUM_LABEL: Record<string, string> = {
  x:        '𝕏',
  facebook: '📘 FB',
  line:     '💬 LINE',
}

export default async function AdminSnsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/sns')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect('/')

  // 次に紹介される 7 件
  const { data: nextTargets } = await supabase.rpc('pick_next_sns_targets', { per_kind: 7 })

  // 過去30日の投稿ログ
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data: logs } = await supabase
    .from('sns_post_logs')
    .select('id, target_type, target_id, medium, status, posted_at, error_message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)

  const total = logs?.length ?? 0
  const success = logs?.filter((l) => l.status === 'success').length ?? 0
  const failed = logs?.filter((l) => l.status === 'failed').length ?? 0
  const pending = logs?.filter((l) => l.status === 'pending').length ?? 0

  // ターゲット情報を一括取得（タイトル表示用）
  const idSetByType: Record<string, Set<string>> = { freefree: new Set(), event: new Set(), org: new Set() }
  ;(nextTargets ?? []).forEach((t: NextTarget) => idSetByType[t.target_type]?.add(t.target_id))
  ;(logs ?? []).forEach((l) => idSetByType[l.target_type]?.add(l.target_id))

  const titles = new Map<string, string>()
  if (idSetByType.freefree.size > 0) {
    const { data } = await supabase.from('freefree_posts').select('id, title').in('id', Array.from(idSetByType.freefree))
    ;(data ?? []).forEach((r) => titles.set(`freefree:${r.id}`, r.title))
  }
  if (idSetByType.event.size > 0) {
    const { data } = await supabase.from('events').select('id, title').in('id', Array.from(idSetByType.event))
    ;(data ?? []).forEach((r) => titles.set(`event:${r.id}`, r.title))
  }
  if (idSetByType.org.size > 0) {
    const { data } = await supabase.from('organizations').select('id, name').in('id', Array.from(idSetByType.org))
    ;(data ?? []).forEach((r) => titles.set(`org:${r.id}`, r.name))
  }

  function titleOf(type: string, id: string): string {
    return titles.get(`${type}:${id}`) ?? `(${id.slice(0, 8)}…)`
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/admin" className="hover:underline">← 管理画面</Link></nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin / SNS</p>
          <h1 className="text-3xl font-serif font-bold">SNS 定期紹介</h1>
          <p className="text-sm text-slate-500 mt-1">
            FreeFree・イベント・団体を X / Facebook / LINE にローテーション投稿。毎日 JST 9時に 1サイクル自動実行。
          </p>
        </header>

        <SnsActions />

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-3">📊 過去 30 日の投稿ログ</h2>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <Stat label="合計" value={total} className="text-slate-900 dark:text-slate-100" />
            <Stat label="成功" value={success} className="text-emerald-600 dark:text-emerald-400" />
            <Stat label="失敗" value={failed} className="text-red-600 dark:text-red-400" />
            <Stat label="未送信" value={pending} className="text-amber-600 dark:text-amber-400" />
          </div>
          {logs && logs.length > 0 ? (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {logs.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-xs border-b border-slate-100 dark:border-slate-800 py-1.5">
                  <span className="w-12 shrink-0 text-slate-500">{new Date(l.created_at).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}</span>
                  <span className="w-20 shrink-0">{TARGET_LABEL[l.target_type] ?? l.target_type}</span>
                  <span className="w-12 shrink-0">{MEDIUM_LABEL[l.medium] ?? l.medium}</span>
                  <span className="w-16 shrink-0">{statusBadge(l.status)}</span>
                  <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{titleOf(l.target_type, l.target_id)}</span>
                  {l.error_message && <span className="text-[10px] text-slate-400 max-w-[200px] truncate">{l.error_message}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">投稿ログはまだありません</p>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-3">🔜 次に紹介される 候補（最も古く紹介されたものから）</h2>
          {nextTargets && nextTargets.length > 0 ? (
            <ul className="space-y-1.5">
              {(nextTargets as NextTarget[]).map((t) => (
                <li key={`${t.target_type}-${t.target_id}`} className="flex items-center gap-2 text-sm border-b border-slate-100 dark:border-slate-800 py-1.5">
                  <span className="w-20 shrink-0 text-xs">{TARGET_LABEL[t.target_type] ?? t.target_type}</span>
                  <span className="flex-1 truncate">{titleOf(t.target_type, t.target_id)}</span>
                  <span className="text-xs text-slate-500 shrink-0">
                    {t.last_spotlighted_at
                      ? `前回 ${new Date(t.last_spotlighted_at).toLocaleDateString('ja-JP')}`
                      : '未紹介'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">候補がありません</p>
          )}
        </section>

        <section className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <div className="font-medium text-slate-700 dark:text-slate-300">💡 認証情報の状態</div>
          <div>📘 Facebook: <code>FACEBOOK_PAGE_ID</code> + <code>FACEBOOK_PAGE_ACCESS_TOKEN</code> 環境変数で接続。未設定なら pending のまま。</div>
          <div>💬 LINE: <code>LINE_CHANNEL_ACCESS_TOKEN</code> 環境変数で接続（Messaging API broadcast）。未設定なら pending のまま。</div>
          <div>𝕏 X: API 有料化のため Phase 2 で接続予定。現状は常に pending 扱い。</div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded p-3 text-center">
      <div className={`text-2xl font-bold ${className ?? ''}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  )
}

function statusBadge(status: string) {
  const cls =
    status === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
    status === 'failed'  ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' :
                           'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
  const label = status === 'success' ? '✓ 成功' : status === 'failed' ? '✗ 失敗' : '⏳ 待機'
  return <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium ${cls}`}>{label}</span>
}
