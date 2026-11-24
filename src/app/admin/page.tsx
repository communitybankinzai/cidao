import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export default async function AdminHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error } = await supabase.rpc('is_admin')
  if (error || !isAdmin) redirect('/')

  // 人材バンクの公開申請の承認待ち件数。承認画面（/admin/talent-bank）と同じく「本人が確認済みで、いま下書きとして残っている版」を数える。
  // 数えられなくても管理画面トップは開けるよう、失敗時は0件扱い（バッジを出さない）にする
  const talentDb = await createTalentBankClient()
  const [profiles, reviewed] = await Promise.all([
    talentDb.from('talent_profiles').select('draft_version_id'),
    talentDb.from('talent_profile_versions').select('id').eq('status', 'owner_reviewed'),
  ])
  const draftIds = new Set((profiles.data ?? []).map(p => p.draft_version_id))
  const pendingApplications = profiles.error || reviewed.error ? 0 : (reviewed.data ?? []).filter(v => draftIds.has(v.id)).length

  // 所属申告の承認待ちの件数。承認の画面を開かなくても、ここで気づけるようにする
  // （2026-11-16：承認の画面が「0件」と出ていて、申告3件に17〜33日だれも気づかなかった）。
  // 数えるだけで、ほかの表を引かない（引き方の間違いで0件に見えるのを避ける）。読めなかったときは「確認できません」と出す。
  const claimCount = await supabase
    .from('memberships')
    .select('org_id', { count: 'exact', head: true })
    .eq('status', 'claimed')
    .is('left_at', null)
  const pendingClaims = claimCount.error ? null : (claimCount.count ?? 0)

  // 投稿の審査待ち（自動類別で引っかかったもの）の件数。content_reviews は service_role 専用の表なので、運営であることを確かめた上で読む。
  // 読めなかったときは0件扱いにせず「件数を確認できません」と出す（所属申告のバッジと同じ作法）
  let pendingReviews: { total: number; held: number } | null = null
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (url && key) {
      const reviewDb = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: reviewRows, error: reviewErr } = await reviewDb
        .from('content_reviews')
        .select('verdict, held')
        .eq('status', 'open')
        .in('verdict', ['notify', 'hold', 'error'])
        .limit(2000)
      if (!reviewErr) pendingReviews = { total: (reviewRows ?? []).length, held: (reviewRows ?? []).filter((r) => r.held === true).length }
    }
  } catch {
    pendingReviews = null
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">管理画面</h1>
        </header>

        <ul className="grid gap-3 sm:grid-cols-2">
          <li><Link href="/admin/talent-bank" className="block bg-white dark:bg-slate-900 border rounded-lg p-5 hover:border-slate-400"><h2 className="text-lg font-semibold mb-1">人材バンク・公開承認{pendingApplications > 0 ? <span className="ml-2 inline-block rounded-full bg-rose-600 px-2 py-0.5 align-middle text-xs font-bold text-white">承認待ち {pendingApplications}件</span> : null}</h2><p className="text-sm text-slate-500">本人確認済みプロフィールの確認・承認・差し戻し</p></Link></li>
          <li>
            <Link
              href="/admin/analytics"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">アクセス分析</h2>
              <p className="text-sm text-slate-500">各ページのPV/VVを横断表示、前週比の増減とAIによる要因分析</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/notice"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">お知らせ配信</h2>
              <p className="text-sm text-slate-500">登録メンバー全員のベル🔔・Webプッシュへ一斉配信、配信履歴の確認</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/changelog"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">更新履歴</h2>
              <p className="text-sm text-slate-500">GitHub のコミットから自動取得した変更ログ</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/audit"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">書き込み記録（IPアドレス）</h2>
              <p className="text-sm text-slate-500">悪質な投稿の発信者を辿るための記録。90日で自動削除</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/freefree"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">FreeFree掲示板の管理</h2>
              <p className="text-sm text-slate-500">サンプル投稿の片付け、迷惑投稿の非公開化・削除</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/claims"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">
                所属申告キュー
                {pendingClaims === null ? (
                  <span className="ml-2 inline-block rounded-full bg-amber-500 px-2 py-0.5 align-middle text-xs font-bold text-white">件数を確認できません</span>
                ) : pendingClaims > 0 ? (
                  <span className="ml-2 inline-block rounded-full bg-rose-600 px-2 py-0.5 align-middle text-xs font-bold text-white">承認待ち {pendingClaims}件</span>
                ) : null}
              </h2>
              <p className="text-sm text-slate-500">既にある団体への所属申告の承認/却下（新しい団体の登録は、承認なしですぐ公開されます）</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/review"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">
                投稿の審査
                {pendingReviews === null ? (
                  <span className="ml-2 inline-block rounded-full bg-amber-500 px-2 py-0.5 align-middle text-xs font-bold text-white">件数を確認できません</span>
                ) : pendingReviews.total > 0 ? (
                  <span className="ml-2 inline-block rounded-full bg-rose-600 px-2 py-0.5 align-middle text-xs font-bold text-white">
                    投稿の審査待ち {pendingReviews.total}件{pendingReviews.held > 0 ? `（止めているもの ${pendingReviews.held}件）` : ''}
                  </span>
                ) : null}
              </h2>
              <p className="text-sm text-slate-500">AI が見つけた、問題のありそうな投稿の確認。確かな疑いのあるものは公開を止めています</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/org-candidates"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">団体候補</h2>
              <p className="text-sm text-slate-500">イベント主催者名のうち未登録のものを、団体として仮登録 / 除外</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/organizers"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">主催者の開催実績</h2>
              <p className="text-sm text-slate-500">主催者名の表記ゆれをまとめた団体別の開催回数・情報元（CSV 出力・まとめ直しも可）</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/orgs"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">団体の公開・非公開</h2>
              <p className="text-sm text-slate-500">団体から申し出があったときに、団体のページを非公開にする / 公開に戻す（削除はしない）</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/sns"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">SNS 定期紹介</h2>
              <p className="text-sm text-slate-500">FreeFree・イベント・団体の X/FB/LINE 紹介ローテーション、投稿ログ、手動実行</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/gourmet"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">食レポの候補（SNS 巡回）</h2>
              <p className="text-sm text-slate-500">AI が見つけた食レポを、お店ごとに承認して食レポマップへ。巡回のスイッチ（既定オフ）</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/freefree/openpoi"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">OpenPOIインポート</h2>
              <p className="text-sm text-slate-500">地域の店舗・施設をOpenPOIから取得し、重複確認のうえFreeFreeへ一括登録</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/disaster-sources"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">災害タイムライン</h2>
              <p className="text-sm text-slate-500">市公式発表・気象庁・市長SNSの取得元管理、テスト取得、手動登録</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/members"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">メンバー一覧（本登録済み）</h2>
              <p className="text-sm text-slate-500">メール確認済み・住所確認済み会員の一覧</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/members/light"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">メンバー一覧（ライト）</h2>
              <p className="text-sm text-slate-500">LINEログインのみで自動作成された会員の一覧</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/events/import"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">チラシ一括取り込み</h2>
              <p className="text-sm text-slate-500">集めたチラシ画像をまとめてAI読み取り、確認してからイベント登録</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/sns-monitor"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">SNS モニタ対象</h2>
              <p className="text-sm text-slate-500">Instagram のイベント告知を毎朝読んで候補にするアカウントの一覧（団体・企業・行政）</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/approvals"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">電子決裁</h2>
              <p className="text-sm text-slate-500">CBI役員の起案・電子印・決裁記録（役員のみ利用可）</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/timetrial"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">タイムトライアル記録</h2>
              <p className="text-sm text-slate-500">メタバース印西の公式ランキング・要確認記録の管理と手動リセット</p>
            </Link>
          </li>
          <li>
            <Link
              href="/admin/events"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">イベント参加者一覧</h2>
              <p className="text-sm text-slate-500">イベントごとの参加者・出欠状況を横断的に確認</p>
            </Link>
          </li>
          <li>
            <a
              href="/admin/phone"
              target="_blank"
              rel="noopener"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">📱 展示用：iPhone 表示で開く</h2>
              <p className="text-sm text-slate-500">iPhone の枠の中に、本物の CiDAO を映す（新しいタブ）。会場のスクリーンで操作説明するときに使う。ログインはこのブラウザのまま。右上の薄いボタンでPC表示に切り替え</p>
            </a>
          </li>
        </ul>
      </div>
    </div>
  )
}
