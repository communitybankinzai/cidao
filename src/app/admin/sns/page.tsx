import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SnsActions from './_components/SnsActions'
import SnsDraftEditor from './_components/SnsDraftEditor'
import AutoPostToggle from './_components/AutoPostToggle'
import SnsAuthSettings, { type SnsAuthStatus } from './_components/SnsAuthSettings'

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
  proposal: '📮 提案',
}

const MEDIUM_LABEL: Record<string, string> = {
  x:         '𝕏',
  facebook:  '📘 FB',
  line:      '💬 LINE',
  threads:   '🧵 Threads',
  instagram: '📷 IG',
}

export default async function AdminSnsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/sns')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect('/')

  // 次に紹介される 7 件
  const { data: nextTargets } = await supabase.rpc('pick_next_sns_targets', { per_kind: 7 })

  // 提案告知の全自動フラグ＋SNS接続状態
  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['sns_auto_post', 'sns_threads_auth', 'sns_facebook_auth', 'sns_instagram_auth'])
  const settingOf = new Map((settingsRows ?? []).map((r) => [r.key, r.value as Record<string, unknown> | null]))
  const autoPostEnabled = (settingOf.get('sns_auto_post') as { enabled?: boolean } | undefined)?.enabled === true

  const thAuth = settingOf.get('sns_threads_auth') as { username?: string; saved_at?: string; expires_at?: string } | undefined
  const fbAuth = settingOf.get('sns_facebook_auth') as { page_name?: string; saved_at?: string } | undefined
  const igAuth = settingOf.get('sns_instagram_auth') as { username?: string; saved_at?: string; expires_at?: string } | undefined
  const authStatus: SnsAuthStatus = {
    threads: thAuth?.saved_at
      ? { username: String(thAuth.username ?? ''), savedAt: String(thAuth.saved_at), expiresAt: thAuth.expires_at ? String(thAuth.expires_at) : null }
      : null,
    facebook: fbAuth?.saved_at
      ? { pageName: String(fbAuth.page_name ?? ''), savedAt: String(fbAuth.saved_at) }
      : null,
    instagram: igAuth?.saved_at
      ? { username: String(igAuth.username ?? ''), savedAt: String(igAuth.saved_at), expiresAt: igAuth.expires_at ? String(igAuth.expires_at) : null }
      : null,
  }

  // 過去30日の投稿ログ
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data: logs } = await supabase
    .from('sns_post_logs')
    .select('id, target_type, target_id, medium, status, posted_at, error_message, created_at, content, approved_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)

  // 未送信のものが承認待ちの対象。ここで本文を確認・修正・承認する
  const awaiting = (logs ?? []).filter((l) => l.status === 'pending')

  const total = logs?.length ?? 0
  const success = logs?.filter((l) => l.status === 'success').length ?? 0
  const failed = logs?.filter((l) => l.status === 'failed').length ?? 0
  const pending = logs?.filter((l) => l.status === 'pending').length ?? 0

  // ターゲット情報を一括取得（タイトル表示用）
  const idSetByType: Record<string, Set<string>> = { freefree: new Set(), event: new Set(), org: new Set(), proposal: new Set() }
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
  if (idSetByType.proposal.size > 0) {
    const { data } = await supabase.from('proposals').select('id, title').in('id', Array.from(idSetByType.proposal))
    ;(data ?? []).forEach((r) => titles.set(`proposal:${r.id}`, r.title))
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
          <h1 className="text-3xl font-serif font-bold">SNS 定期紹介・提案告知</h1>
          <p className="text-sm text-slate-500 mt-1">
            FreeFree・イベント・団体を X / Facebook / LINE にローテーション投稿（毎日 JST 9時）。
            CiDAO の新しい提案は Threads / Facebook / Instagram へ告知（作成時に下書き自動生成）。
          </p>
        </header>

        <AutoPostToggle initialEnabled={autoPostEnabled} />

        <SnsAuthSettings status={authStatus} />

        <SnsActions />

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">✍️ 投稿文の確認・承認（{awaiting.length} 件）</h2>
          <p className="text-xs text-slate-500 mb-3">
            立ち上げ期は運営が事前に本文を確認する運用です（開発仕様書 v2.1 §3.11.4）。
            <strong className="font-medium">承認したものだけが実際に配信されます。</strong>
          </p>
          {awaiting.length > 0 ? (
            <ul className="space-y-3 max-h-[36rem] overflow-y-auto">
              {awaiting.map((l) => (
                <SnsDraftEditor
                  key={l.id}
                  log={{
                    id: l.id,
                    target_type: l.target_type,
                    target_id: l.target_id,
                    medium: l.medium,
                    content: (l.content as string | null) ?? null,
                    approved_at: (l.approved_at as string | null) ?? null,
                    title: titleOf(l.target_type, l.target_id),
                    mediumLabel: MEDIUM_LABEL[l.medium] ?? l.medium,
                    targetLabel: TARGET_LABEL[l.target_type] ?? l.target_type,
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">承認待ちの投稿はありません</p>
          )}
        </section>

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
          <div>🧵 Threads / 📷 Instagram / 📘 Facebook: 上の「SNS接続設定」から保存（環境変数 <code>THREADS_*</code> / <code>FACEBOOK_*</code> はフォールバック）。未設定なら pending のまま。</div>
          <div>💬 LINE: <code>LINE_CHANNEL_ACCESS_TOKEN</code> 環境変数で接続（Messaging API broadcast）。未設定なら pending のまま。</div>
          <div>📷 Instagram の投稿は提案告知のみ対応（告知カード画像を自動生成して添付。定期紹介は対象外）。</div>
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
