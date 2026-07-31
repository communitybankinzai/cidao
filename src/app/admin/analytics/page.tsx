// 管理画面: アクセス分析ダッシュボード
//
// page_views の集計（admin 専用 RPC）を横断表示する。
//   - 今日 / 直近7日 vs 前7日 のサマリカード（比較併記）
//   - 直近30日の日別 PV / VV 推移（折れ線）
//   - ページ別の直近7日 PV / VV と前週比
//   - AI 分析ボタン（増減要因の仮説と推奨アクションを Claude が生成）
//
// イベント個別の内訳は各イベント詳細ページ（event_view_stats）が担当。

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AnalyzeButton } from './_components/AnalyzeButton'

type DailyRow = { day: string; pv: number; vv: number }
type PathRow = { path: string; pv: number; vv: number; prev_pv: number; prev_vv: number }

// ルートパターン → 画面名（未登録のパスはそのまま表示）
const PAGE_LABELS: Record<string, string> = {
  '/': 'トップ',
  '/events': 'イベント一覧',
  '/events/[id]': 'イベント詳細',
  '/events/new': 'イベント作成',
  '/events/[id]/edit': 'イベント編集',
  '/freefree': 'FreeFree一覧',
  '/freefree/[id]': 'FreeFree詳細',
  '/orgs': '団体一覧',
  '/orgs/[id]': '団体詳細',
  '/orgs/[id]/reception': '受付',
  '/orgs/[id]/reception/history': '受付履歴',
  '/proposals': '提案一覧',
  '/proposals/[id]': '提案詳細',
  '/talent': '人材一覧',
  '/talent/[id]': '人材詳細',
  '/ranking': 'ランキング',
  '/match': 'マッチング',
  '/help': 'ヘルプ',
  '/install': 'アプリ追加',
  '/login': 'ログイン',
  '/bug-report': '不具合報告',
}

function pct(current: number, prev: number): string {
  if (prev === 0) return current === 0 ? '±0%' : '（前週データなし）'
  const p = Math.round(((current - prev) / prev) * 100)
  return p >= 0 ? `+${p}%` : `${p}%`
}

function jstNow(): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
}

// 直近30日の PV / VV 折れ線（SVG）。PV=青実線、VV=橙破線で色以外でも区別する
function DailyChart({ rows }: { rows: DailyRow[] }) {
  if (rows.length < 2) {
    return <p className="text-sm text-slate-500">グラフはデータが2日分たまると表示されます。</p>
  }
  const W = 640
  const H = 200
  const PAD = { top: 10, right: 10, bottom: 24, left: 40 }
  const max = Math.max(...rows.map((r) => r.pv), 1)
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (rows.length - 1)
  const y = (v: number) => H - PAD.bottom - (v * (H - PAD.top - PAD.bottom)) / max
  const line = (key: 'pv' | 'vv') => rows.map((r, i) => `${x(i)},${y(r[key])}`).join(' ')
  const gridValues = [0, Math.round(max / 2), max]
  const fmtDay = (d: string) => d.slice(5).replace('-', '/')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="日別PV/VV推移">
      {gridValues.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
            className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1"
          />
          <text
            x={PAD.left - 6} y={y(v) + 4} textAnchor="end"
            className="fill-slate-500 text-[11px]"
          >
            {v.toLocaleString()}
          </text>
        </g>
      ))}
      <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[11px]">{fmtDay(rows[0].day)}</text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[11px]">
        {fmtDay(rows[rows.length - 1].day)}
      </text>
      <polyline points={line('pv')} fill="none" stroke="#2563eb" strokeWidth="2" />
      <polyline points={line('vv')} fill="none" stroke="#ea580c" strokeWidth="2" strokeDasharray="5 3" />
    </svg>
  )
}

export default async function AdminAnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error } = await supabase.rpc('is_admin')
  if (error || !isAdmin) redirect('/')

  const [dailyRes, byPathRes] = await Promise.all([
    supabase.rpc('page_view_daily', { p_days: 30 }),
    supabase.rpc('page_view_by_path', { p_days: 7 }),
  ])
  const daily: DailyRow[] = dailyRes.data ?? []
  const byPath: PathRow[] = byPathRes.data ?? []
  const loadError = dailyRes.error?.message ?? byPathRes.error?.message ?? null

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  const byDay = new Map(daily.map((r) => [r.day, r]))
  const today = byDay.get(todayStr) ?? { pv: 0, vv: 0 }
  const last7 = daily.filter((r) => r.day > shiftDate(todayStr, -7))
  const prev7 = daily.filter((r) => r.day <= shiftDate(todayStr, -7) && r.day > shiftDate(todayStr, -14))
  const sum = (rows: { pv: number; vv: number }[], key: 'pv' | 'vv') =>
    rows.reduce((a, r) => a + r[key], 0)
  const yesterday = byDay.get(shiftDate(todayStr, -1)) ?? { pv: 0, vv: 0 }

  const cards = [
    { label: '今日のPV', value: today.pv, compare: `前日比 ${pct(today.pv, yesterday.pv)}` },
    { label: '今日のVV（訪問端末数）', value: today.vv, compare: `前日比 ${pct(today.vv, yesterday.vv)}` },
    { label: '直近7日PV', value: sum(last7, 'pv'), compare: `前週比 ${pct(sum(last7, 'pv'), sum(prev7, 'pv'))}` },
    { label: '直近7日VV', value: sum(last7, 'vv'), compare: `前週比 ${pct(sum(last7, 'vv'), sum(prev7, 'vv'))}` },
  ]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/admin" className="hover:underline">← 管理画面</Link>
        </nav>
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Analytics</p>
            <h1 className="text-3xl font-serif font-bold">アクセス分析</h1>
          </div>
          <p className="text-xs text-slate-500">集計時点: {jstNow()}（JST）／単位: 件</p>
        </header>

        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            集計の取得に失敗しました（マイグレーション未適用の可能性）: {loadError}
          </p>
        )}

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold text-right tabular-nums">{c.value.toLocaleString()}</p>
              <p className="text-xs text-slate-500 text-right">{c.compare}</p>
            </div>
          ))}
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold">日別推移（直近30日）</h2>
            <p className="text-xs text-slate-500">
              <span className="inline-block w-4 border-t-2 border-[#2563eb] align-middle mr-1" />PV（閲覧回数）
              <span className="inline-block w-4 border-t-2 border-dashed border-[#ea580c] align-middle ml-3 mr-1" />VV（訪問端末数）
            </p>
          </div>
          <DailyChart rows={daily} />
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="text-lg font-semibold">ページ別（直近7日）</h2>
          {byPath.length === 0 ? (
            <p className="text-sm text-slate-500">まだ記録がありません。公開ページが閲覧されると表示されます。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left py-2 pr-3 font-normal">ページ</th>
                    <th className="text-right py-2 px-3 font-normal">PV</th>
                    <th className="text-right py-2 px-3 font-normal">VV</th>
                    <th className="text-right py-2 pl-3 font-normal">PV前週比</th>
                  </tr>
                </thead>
                <tbody>
                  {byPath.map((r) => (
                    <tr key={r.path} className="border-b border-slate-100 dark:border-slate-800/50">
                      <td className="py-2 pr-3">
                        {PAGE_LABELS[r.path] ?? r.path}
                        <span className="text-xs text-slate-400 ml-2">{PAGE_LABELS[r.path] ? r.path : ''}</span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.pv.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.vv.toLocaleString()}</td>
                      <td className="py-2 pl-3 text-right tabular-nums">{pct(r.pv, r.prev_pv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="text-lg font-semibold">AI 分析（増減要因の仮説）</h2>
          <p className="text-sm text-slate-500">
            直近30日の推移とページ別の前週比を Claude に渡し、増減の要因仮説と推奨アクションを生成します。
            実行のたびに AI 利用料が発生します。
          </p>
          <AnalyzeButton />
        </section>
      </div>
    </div>
  )
}

// 'YYYY-MM-DD' に日数を加算（UTC演算で日付のみ扱うためタイムゾーンの影響なし）
function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
