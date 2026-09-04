import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DeleteTrialButton, ResetAllButton, RequirementsForm, RenderQualityForm, EventForm } from './_components/TrialControls'

// メタバース印西「文化財タイムトライアル」の記録管理。
// ランキング（公式記録）・フラグ付き記録（要確認）・全記録の一覧と、
// デモイベントのやり直し用の手動リセットを提供する。

export const dynamic = 'force-dynamic'

type TrialRow = {
  id: string
  name: string
  age_key: string
  course_key: string
  checkpoints_total: number
  checkpoints_passed: number
  quiz_rate_pct: number
  quiz_answers: number
  started_at: string
  finished_at: string | null
  elapsed_ms: number | null
  record_code: string | null
  status: string
  flags: string[]
}

const COURSE_LABEL: Record<string, string> = {
  beginner: '🔰 初級（3か所）',
  intermediate: '🥈 中級（5か所）',
  advanced: '🥇 上級（7か所）',
  full: '🏁 完走（50か所）',
  night: '🌃 夜景 いんザイ君ゲート（10か所）',
}
const AGE_LABEL: Record<string, string> = {
  kids: '小学生以下',
  teens: '中高生',
  adult: '一般',
  night: '夜景（区分なし）',
}

function fmtTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const d = Math.floor((ms % 1000) / 100)
  return `${m}:${String(s).padStart(2, '0')}.${d}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default async function AdminTimetrialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/timetrial')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) redirect('/')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const service = createSupabaseAdmin(url, key, { auth: { persistSession: false } })

  const { data, error } = await service
    .from('metaverse_tt_trials')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  const trials = (data ?? []) as TrialRow[]

  // 参加要件（イベントごとに変更可。未設定なら既定 80%・10問）
  const { data: reqRow } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'metaverse_tt_requirements')
    .maybeSingle()
  const reqValue = (reqRow?.value ?? {}) as { minRatePct?: number; minAnswers?: number }
  const minRatePct = Number.isFinite(Number(reqValue.minRatePct)) ? Number(reqValue.minRatePct) : 80
  const minAnswers = Number.isFinite(Number(reqValue.minAnswers)) ? Number(reqValue.minAnswers) : 10

  // 3Dの描画精度（未設定なら既定 8＝鮮明）。サイト側は /api/metaverse-usage 経由で受け取る
  const { data: rqRow } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'metaverse_render_quality')
    .maybeSingle()
  const rqValue = (rqRow?.value ?? {}) as { maximumScreenSpaceError?: number }
  const sseRaw = Number(rqValue.maximumScreenSpaceError)
  const maximumScreenSpaceError = Number.isFinite(sseRaw) && sseRaw >= 2 && sseRaw <= 64 ? sseRaw : 8

  // イベント期間（未設定なら通常運用）。サイト側は API の event として受け取る
  const { data: evRow } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'metaverse_tt_event')
    .maybeSingle()
  const evValue = (evRow?.value ?? {}) as { name?: string; from?: string; to?: string }
  const eventName = String(evValue.name ?? '')
  const eventFrom = String(evValue.from ?? '')
  const eventTo = String(evValue.to ?? '')
  const eventActive = !!eventName && !!eventFrom && !!eventTo &&
    Date.now() >= new Date(eventFrom).getTime() && Date.now() <= new Date(eventTo).getTime()

  const finished = trials.filter((t) => t.status === 'finished')
  const flagged = trials.filter((t) => t.status === 'flagged')
  const running = trials.filter((t) => t.status === 'running')

  const rankingByCourse = Object.keys(COURSE_LABEL).map((courseKey) => ({
    courseKey,
    rows: finished
      .filter((t) => t.course_key === courseKey && t.elapsed_ms !== null)
      .sort((a, b) => Number(a.elapsed_ms) - Number(b.elapsed_ms))
      .slice(0, 20),
  })).filter((g) => g.rows.length > 0)

  const th = 'px-2 py-1.5 text-left text-xs font-semibold text-slate-500 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-sm whitespace-nowrap'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <nav className="text-xs text-slate-500"><Link href="/admin" className="hover:underline">← 管理画面</Link></nav>
        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">⏱ タイムトライアル記録</h1>
          <p className="text-sm text-slate-500">
            メタバース印西「文化財タイムトライアル」のサーバー公式記録。
            公式 {finished.length} 件 ／ 要確認（フラグ付き）{flagged.length} 件 ／ 未完走・進行中 {running.length} 件
            {error ? <span className="text-red-600">（読み込みエラー: {error.message}）</span> : null}
          </p>
        </header>

        <section className="bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-800 rounded-lg p-5 space-y-2">
          <h2 className="text-lg font-semibold">⚙ 参加要件（イベントごとに変更できます）</h2>
          <p className="text-xs text-slate-500">
            現在の要件：クイズ正答率 <b>{minRatePct}%</b> 以上・<b>{minAnswers}問</b> 以上解答。
            保存するとメタバースの参加判定とサーバーの受付判定に即時反映されます（参加者はエントリー画面を開き直せばOK）。
          </p>
          <RequirementsForm initialRatePct={minRatePct} initialAnswers={minAnswers} />
        </section>

        <section className="bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-800 rounded-lg p-5 space-y-2">
          <h2 className="text-lg font-semibold">🎪 イベント期間</h2>
          <p className="text-xs text-slate-500">
            {eventName
              ? <>現在の設定：<b>{eventName}</b>（{fmtDate(eventFrom)} 〜 {fmtDate(eventTo)}）{eventActive ? <b className="text-emerald-600">・開催中</b> : '・期間外'}</>
              : <>未設定（通常運用）。</>}
            <br />
            設定するとメタバースのランキングに「イベント」の期間が選べるようになり、期間中はそれが既定になります。
            ゴール時の結果画面にはイベント内の順位も出ます。通常時は参加者が「全期間／今月／直近7日」で切り替えられます。
            名前を空にして保存すると解除します。
          </p>
          <EventForm initialName={eventName} initialFrom={eventFrom} initialTo={eventTo} />
        </section>

        <section className="bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-800 rounded-lg p-5 space-y-2">
          <h2 className="text-lg font-semibold">🖼 3Dの描画精度</h2>
          <p className="text-xs text-slate-500">
            現在の設定：<b>{maximumScreenSpaceError}</b>（小さいほど鮮明）。
            値を下げると建物が細かく表示されますが、タイルの取得数が増えて Google 側の1日上限に早く達します
            （達すると詳細タイルが止まり「本日の利用枠に達しました」の案内が出ます）。
            課金は閲覧開始のリクエスト単位なので、この値を変えても<b>費用は増えません</b>。
            <br />
            イベントで同時利用が多い日は 16〜32 に上げてください。保存すると、
            <b>すでに開いている画面にも5分以内に反映</b>されます。
          </p>
          <RenderQualityForm initialSse={maximumScreenSpaceError} />
        </section>

        {rankingByCourse.map(({ courseKey, rows }) => (
          <section key={courseKey} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-3">🏆 ランキング — {COURSE_LABEL[courseKey]}</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={th}>順位</th><th className={th}>ニックネーム</th><th className={th}>タイム</th>
                  <th className={th}>年齢区分</th><th className={th}>正答率</th><th className={th}>ゴール日時</th>
                  <th className={th}>記録ID</th><th className={th}></th>
                </tr></thead>
                <tbody>
                  {rows.map((t, i) => (
                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className={td}>{i + 1}</td>
                      <td className={td + ' font-semibold'}>{t.name}</td>
                      <td className={td + ' font-mono'}>{fmtTime(t.elapsed_ms)}</td>
                      <td className={td}>{AGE_LABEL[t.age_key] ?? t.age_key}</td>
                      <td className={td}>{t.quiz_rate_pct}%（{t.quiz_answers}問）</td>
                      <td className={td}>{fmtDate(t.finished_at)}</td>
                      <td className={td + ' font-mono text-xs text-slate-500'}>{t.record_code}</td>
                      <td className={td}><DeleteTrialButton id={t.id} name={t.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {rankingByCourse.length === 0 && (
          <p className="text-sm text-slate-500">公式記録はまだありません。</p>
        )}

        <section className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">⚠ 要確認（フラグ付き）記録</h2>
          <p className="text-xs text-slate-500 mb-3">
            通過順序の違反や、物理的にあり得ない速さの区間があった記録。ランキングには載りません。
            正当と判断できない場合は削除してください（fast-leg:区間番号:間隔秒）。
          </p>
          {flagged.length === 0 ? <p className="text-sm text-slate-500">ありません。</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={th}>ニックネーム</th><th className={th}>コース</th><th className={th}>タイム</th>
                  <th className={th}>フラグ内容</th><th className={th}>日時</th><th className={th}>記録ID</th><th className={th}></th>
                </tr></thead>
                <tbody>
                  {flagged.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className={td + ' font-semibold'}>{t.name}</td>
                      <td className={td}>{COURSE_LABEL[t.course_key] ?? t.course_key}</td>
                      <td className={td + ' font-mono'}>{fmtTime(t.elapsed_ms)}</td>
                      <td className={td + ' text-xs text-amber-700 dark:text-amber-400'}>{(t.flags ?? []).join(', ')}</td>
                      <td className={td}>{fmtDate(t.finished_at ?? t.started_at)}</td>
                      <td className={td + ' font-mono text-xs text-slate-500'}>{t.record_code ?? '—'}</td>
                      <td className={td}><DeleteTrialButton id={t.id} name={t.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">🏃 未完走・進行中</h2>
          <p className="text-xs text-slate-500 mb-3">スタートしたがゴールしていない記録（中止・離脱を含む）。残っていても害はありません。</p>
          {running.length === 0 ? <p className="text-sm text-slate-500">ありません。</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className={th}>ニックネーム</th><th className={th}>コース</th><th className={th}>通過</th>
                  <th className={th}>スタート日時</th><th className={th}></th>
                </tr></thead>
                <tbody>
                  {running.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className={td}>{t.name}</td>
                      <td className={td}>{COURSE_LABEL[t.course_key] ?? t.course_key}</td>
                      <td className={td}>{t.checkpoints_passed}/{t.checkpoints_total}</td>
                      <td className={td}>{fmtDate(t.started_at)}</td>
                      <td className={td}><DeleteTrialButton id={t.id} name={t.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border border-red-300 dark:border-red-800 rounded-lg p-5 space-y-2">
          <h2 className="text-lg font-semibold">🗑 手動リセット</h2>
          <p className="text-xs text-slate-500">
            デモイベントのやり直しなどで全記録（{trials.length}件）を削除します。取り消しはできません。
            誤操作防止のため「リセット」と入力してから実行してください。
          </p>
          <ResetAllButton total={trials.length} />
        </section>
      </div>
    </div>
  )
}
