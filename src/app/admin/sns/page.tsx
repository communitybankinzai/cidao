import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import SnsActions from './_components/SnsActions'
import AwaitingList from './_components/AwaitingList'
import AutoPostToggle from './_components/AutoPostToggle'
import SnsAuthSettings, { type SnsAuthStatus } from './_components/SnsAuthSettings'
import RotationScheduleCard from './_components/RotationScheduleCard'
import RetryButton from './_components/RetryButton'
import DisasterSnsMonitorRules, { type DisasterMonitorRule } from './_components/DisasterSnsMonitorRules'
import type { RotationPreset } from './actions'

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

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const monitorAdmin = serviceUrl && serviceKey
    ? createSupabaseAdmin(serviceUrl, serviceKey, { auth: { persistSession: false } })
    : null
  const { data: monitorRuleRows } = monitorAdmin
    ? await monitorAdmin
        .from('disaster_sns_monitor_rules')
        .select('platform, query, enabled')
        .order('platform')
        .order('query')
    : { data: null }
  const disasterMonitorRules = (monitorRuleRows ?? []).filter((rule): rule is DisasterMonitorRule => (
    ['threads', 'instagram', 'bluesky'].includes(rule.platform)
      && typeof rule.query === 'string'
      && typeof rule.enabled === 'boolean'
  ))

  // 次に紹介される 7 件
  const { data: nextTargets } = await supabase.rpc('pick_next_sns_targets', { per_kind: 7 })

  // ローテーションの現在の実行間隔（pg_cron ジョブから取得。行なし＝停止）
  const { data: scheduleRows } = await supabase.rpc('get_sns_rotation_schedule')
  const scheduleExpr: string | null = scheduleRows?.[0]?.schedule ?? null
  const PRESET_BY_EXPR: Record<string, RotationPreset> = {
    '0 0 * * *': 'daily',
    '0 0 */2 * *': 'every2days',
    '0 0 * * 1': 'weekly',
    '0 0 1 * *': 'monthly',
  }
  const currentPreset: RotationPreset | null = scheduleExpr ? (PRESET_BY_EXPR[scheduleExpr] ?? null) : null

  // 提案告知の全自動フラグ＋SNS接続状態
  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['sns_auto_post', 'sns_threads_auth', 'sns_threads_app', 'sns_threads_discovery_auth', 'sns_facebook_auth', 'sns_instagram_auth', 'sns_instagram_discovery_auth', 'sns_bluesky_search_auth'])
  const settingOf = new Map((settingsRows ?? []).map((r) => [r.key, r.value as Record<string, unknown> | null]))
  const autoPostEnabled = (settingOf.get('sns_auto_post') as { enabled?: boolean } | undefined)?.enabled === true

  const thAuth = settingOf.get('sns_threads_auth') as { username?: string; saved_at?: string; expires_at?: string; keyword_search_ready?: boolean } | undefined
  const thApp = settingOf.get('sns_threads_app') as { app_id?: string; saved_at?: string } | undefined
  const thDiscovery = settingOf.get('sns_threads_discovery_auth') as { username?: string; saved_at?: string; keyword_search_ready?: boolean } | undefined
  const fbAuth = settingOf.get('sns_facebook_auth') as { page_name?: string; saved_at?: string } | undefined
  const igAuth = settingOf.get('sns_instagram_auth') as { username?: string; saved_at?: string; expires_at?: string } | undefined
  const igDiscoveryAuth = settingOf.get('sns_instagram_discovery_auth') as { username?: string; saved_at?: string } | undefined
  const bskySearchAuth = settingOf.get('sns_bluesky_search_auth') as { handle?: string; saved_at?: string } | undefined
  const authStatus: SnsAuthStatus = {
    threads: thAuth?.saved_at
      ? { username: String(thAuth.username ?? ''), savedAt: String(thAuth.saved_at), expiresAt: thAuth.expires_at ? String(thAuth.expires_at) : null, keywordSearchReady: thAuth.keyword_search_ready === true }
      : null,
    threadsApp: thApp?.app_id ? { savedAt: String(thApp.saved_at ?? '') } : null,
    threadsSearch: thDiscovery?.saved_at
      ? { username: String(thDiscovery.username ?? ''), savedAt: String(thDiscovery.saved_at), keywordSearchReady: thDiscovery.keyword_search_ready === true }
      : null,
    facebook: fbAuth?.saved_at
      ? { pageName: String(fbAuth.page_name ?? ''), savedAt: String(fbAuth.saved_at) }
      : null,
    instagram: igAuth?.saved_at
      ? { username: String(igAuth.username ?? ''), savedAt: String(igAuth.saved_at), expiresAt: igAuth.expires_at ? String(igAuth.expires_at) : null }
      : null,
    instagramDiscovery: igDiscoveryAuth?.saved_at
      ? { username: String(igDiscoveryAuth.username ?? ''), savedAt: String(igDiscoveryAuth.saved_at) }
      : null,
    blueskySearch: bskySearchAuth?.saved_at
      ? { handle: String(bskySearchAuth.handle ?? ''), savedAt: String(bskySearchAuth.saved_at) }
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
            FreeFree・団体は毎朝9時のローテーションで、提案は作成時に、それぞれ告知の下書きが自動生成されます
            （団体は新規登録・紹介内容の更新時にも生成。配信先：Threads、提案のみ Instagram も）。
            イベントは毎朝のまとめ配信で告知するため、ローテーション単独紹介の対象外です。
          </p>
        </header>

        <details className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 rounded-lg p-5">
          <summary className="cursor-pointer font-semibold text-sky-900 dark:text-sky-200">
            ❓ このページの使い方（承認と配信の仕組み）
          </summary>
          <div className="mt-4 space-y-4 text-sm text-slate-700 dark:text-slate-300">
            <div>
              <h3 className="font-medium mb-1">下書きはどこから来るのか</h3>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">
                <li><strong>提案</strong>：CiDAOに提案が作成されると自動生成（Threads / Instagram / Facebook）</li>
                <li><strong>団体</strong>：新規登録・紹介内容の更新のタイミングで自動生成＋毎朝9時のローテーションでも定期紹介（Threads）</li>
                <li><strong>FreeFree</strong>：毎朝9時のローテーションが「最近紹介していないもの」から1件ずつ生成（Threads。🌟 イベントカテゴリの掲載分も対象）</li>
                <li><strong>イベント</strong>：毎朝のまとめ配信で告知するため、ローテーションによる単独紹介は行いません</li>
              </ul>
              <p className="text-xs mt-1">下書きができると管理者へベル・プッシュ・メールで通知が届きます。</p>
            </div>
            <div>
              <h3 className="font-medium mb-1">「承認」と「配信」は別の操作</h3>
              <p className="text-xs mb-2">承認＝「この文面で配信してよい」という意思表示。配信＝実際にSNSへ投稿する行為。</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-sky-200 dark:border-sky-900 text-left">
                      <th className="py-1.5 pr-3">ボタン</th>
                      <th className="py-1.5 pr-3">対象</th>
                      <th className="py-1.5 pr-3">承認操作</th>
                      <th className="py-1.5">配信タイミング</th>
                    </tr>
                  </thead>
                  <tbody className="align-top">
                    <tr className="border-b border-sky-100 dark:border-sky-900/50">
                      <td className="py-1.5 pr-3 whitespace-nowrap">承認する（18時台に配信）</td>
                      <td className="py-1.5 pr-3">その1件</td>
                      <td className="py-1.5 pr-3">する</td>
                      <td className="py-1.5">毎日18時台の自動配信を待つ（急がない告知向け）</td>
                    </tr>
                    <tr className="border-b border-sky-100 dark:border-sky-900/50">
                      <td className="py-1.5 pr-3 whitespace-nowrap">⚡ 今すぐ投稿</td>
                      <td className="py-1.5 pr-3">その1件</td>
                      <td className="py-1.5 pr-3">する</td>
                      <td className="py-1.5">押した瞬間に配信（イベント当日など急ぎ向け）</td>
                    </tr>
                    <tr className="border-b border-sky-100 dark:border-sky-900/50">
                      <td className="py-1.5 pr-3 whitespace-nowrap">📤 pending を実投稿</td>
                      <td className="py-1.5 pr-3"><strong>承認済み</strong>の全件</td>
                      <td className="py-1.5 pr-3"><strong>しない</strong></td>
                      <td className="py-1.5">押した瞬間にまとめて配信。未承認のものは流れない</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-3 whitespace-nowrap">却下</td>
                      <td className="py-1.5 pr-3">その1件</td>
                      <td className="py-1.5 pr-3">—</td>
                      <td className="py-1.5">配信せずリストから削除（ローテ対象にはいずれ再登場）</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-1">放置した下書きはどうなるか</h3>
              <p className="text-xs">承認しないまま30日経つと自動削除されます。急いで捌く必要はありません。</p>
            </div>
            <div>
              <h3 className="font-medium mb-1">トークン（SNS接続）の維持</h3>
              <p className="text-xs">Threads / Instagram のトークンは毎週月曜朝に自動延長されるため、手動更新は不要です。「失効予定」の日付が近づいたまま更新されない場合のみ、SNS接続設定から再発行・再保存してください。</p>
            </div>
          </div>
        </details>

        <AutoPostToggle initialEnabled={autoPostEnabled} />

        <RotationScheduleCard current={currentPreset} />

        <SnsAuthSettings status={authStatus} />

        <DisasterSnsMonitorRules initialRules={disasterMonitorRules} />

        <SnsActions />

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">✍️ 投稿文の確認・承認（{awaiting.length} 件）</h2>
          <p className="text-xs text-slate-500 mb-3">
            立ち上げ期は運営が事前に本文を確認する運用です（開発仕様書 v2.1 §3.11.4）。
            <strong className="font-medium">承認したものだけが配信されます。</strong>
            承認済みのものは<strong className="font-medium">毎日18時台（日本時間）に自動配信</strong>されます
            （実行タイミングに最大1時間の幅があるため18:00ちょうどではありません）。
            すぐ流したいときは上の「pending を実投稿」を押してください。
          </p>
          {awaiting.length > 0 ? (
            <AwaitingList
              logs={awaiting.map((l) => ({
                id: l.id,
                target_type: l.target_type,
                target_id: l.target_id,
                medium: l.medium,
                content: (l.content as string | null) ?? null,
                approved_at: (l.approved_at as string | null) ?? null,
                created_at: l.created_at,
                title: titleOf(l.target_type, l.target_id),
                mediumLabel: MEDIUM_LABEL[l.medium] ?? l.medium,
                targetLabel: TARGET_LABEL[l.target_type] ?? l.target_type,
              }))}
            />
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
                  {l.status === 'failed' && <RetryButton logId={l.id} label={`${titleOf(l.target_type, l.target_id)}（${MEDIUM_LABEL[l.medium] ?? l.medium}）`} />}
                  {l.error_message && <span className="text-[10px] text-slate-400 max-w-[200px] truncate" title={l.error_message}>{l.error_message}</span>}
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

        <section className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-xs text-slate-600 dark:text-slate-400 space-y-3">
          <div className="font-medium text-slate-700 dark:text-slate-300">💡 媒体別の状況（配信されない媒体とその理由）</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left border-b border-slate-300 dark:border-slate-700">
                  <th className="py-1.5 pr-3 whitespace-nowrap">媒体</th>
                  <th className="py-1.5 pr-3 whitespace-nowrap">状況</th>
                  <th className="py-1.5">理由・備考</th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <td className="py-1.5 pr-3 whitespace-nowrap">🧵 Threads</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-emerald-600 dark:text-emerald-400">✅ 稼働中</td>
                  <td className="py-1.5">すべての対象を配信。トークンは毎週月曜朝に自動更新（2026-08-06 接続）</td>
                </tr>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <td className="py-1.5 pr-3 whitespace-nowrap">📷 Instagram</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-emerald-600 dark:text-emerald-400">✅ 稼働中</td>
                  <td className="py-1.5">提案告知のみ。Instagram APIは画像必須のため、提案タイトル入りの告知カード画像を自動生成して添付する（定期紹介は画像を用意できないため対象外）</td>
                </tr>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <td className="py-1.5 pr-3 whitespace-nowrap">📘 Facebook</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-amber-600 dark:text-amber-400">⏸ 見送り中</td>
                  <td className="py-1.5">CBI名義のFacebookページが未開設のため（2026-08-15 決定）。配信コードは実装済みなので、ページを開設して「SNS接続設定」にトークンを保存すれば有効化できる</td>
                </tr>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <td className="py-1.5 pr-3 whitespace-nowrap">💬 LINE</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-amber-600 dark:text-amber-400">⏸ 見送り中</td>
                  <td className="py-1.5">配信コードは実装済みだがトークン未設定。LINEの配信は「公式アカウントの友だち全員へのプッシュ通知」でSNSのタイムライン投稿とは性格が異なるため、何をどの頻度で流すかの運用方針を決めてから接続する</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 whitespace-nowrap">𝕏 X</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">⏸ 未実装</td>
                  <td className="py-1.5">X APIの有料化により見送り（無料枠は投稿数制限が厳しく、実用には月額課金が必要）。需要とコストが見合う判断になった時点で実装する</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>👥 団体のローテーション候補は「代表者の関与が確認できた団体」のみ：代表者が内容を確認・編集した「更新済み」団体、または代表者としての参加が承認済みの団体。管理者が代理登録しただけの団体や一括取り込みの仮登録団体は紹介しません。claim（代表者確認）や編集で条件を満たせば自動で候補入りします（追加作業は不要）。運営元の CBI 自身は紹介する側のため対象外です。</div>
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
