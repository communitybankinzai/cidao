import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { BulkFlyerImport } from './_components/BulkFlyerImport'
import { KouhouPdfImport } from './_components/KouhouPdfImport'
import { InzaiBunkaSyncRuns, type SyncRunRow } from './_components/InzaiBunkaSyncRuns'
import { CosmosCandidates } from './_components/CosmosCandidates'
import { listCosmosCandidates } from './actions'

export default async function AdminEventImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  // これまでこの画面から取り込んだ件数（COCoLa 経由分と区別して数える）
  const [{ count: flyerCount }, { count: kouhouCount }, { count: bunkaCount }, { data: bunkaRuns }] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('external_source', 'cbi-admin-import'),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('external_source', 'cbi-kouhou-import'),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('external_source', 'inzai-bunka-calendar'),
    supabase
      .from('event_sync_runs')
      .select('id, started_at, finished_at, ok, dry_run, fetched, inserted, updated, unchanged, duplicates, skipped, errors, detail')
      .eq('source', 'inzai-bunka-calendar')
      .order('started_at', { ascending: false })
      .limit(14),
  ])
  // 広報いんざい読み取りの推定費用（api_usage・purpose=event_scan_pdf。2026-09-16 から記録）
  const monthStartJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  monthStartJst.setDate(1)
  monthStartJst.setHours(0, 0, 0, 0)
  const [{ data: cosmosRuns }, cosmosCandidates, { data: scanUsage }, { data: cityRuns }] = await Promise.all([
    supabase
      .from('event_sync_runs')
      .select('id, started_at, finished_at, ok, dry_run, fetched, inserted, updated, unchanged, duplicates, skipped, errors, detail')
      .eq('source', 'goguynet-cosmos')
      .order('started_at', { ascending: false })
      .limit(14),
    listCosmosCandidates(),
    supabase.from('api_usage').select('est_cost_jpy, created_at, model').eq('purpose', 'event_scan_pdf').limit(2000),
    supabase
      .from('event_sync_runs')
      .select('id, started_at, finished_at, ok, dry_run, fetched, inserted, updated, unchanged, duplicates, skipped, errors, detail')
      .eq('source', 'inzai-city-calendar')
      .order('started_at', { ascending: false })
      .limit(14),
  ])
  const scanRows = (scanUsage ?? []) as { est_cost_jpy: number | null; created_at: string; model: string }[]
  const scanCostTotal = scanRows.reduce((s, r) => s + (r.est_cost_jpy ?? 0), 0)
  const scanCostMonth = scanRows.filter((r) => new Date(r.created_at) >= monthStartJst).reduce((s, r) => s + (r.est_cost_jpy ?? 0), 0)
  const scanCallsMonth = scanRows.filter((r) => new Date(r.created_at) >= monthStartJst).length

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-10">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
          <Link href="/admin/events" className="hover:underline">イベント参加者一覧</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">イベント一括取り込み</h1>
          <p className="text-xs text-slate-500">
            広報いんざいのPDF、または集めたチラシ画像から、AIが日時・場所・主催者を読み取ります。
            どちらも読み取り結果をそのまま登録せず、一覧で確認・修正してから登録します。
            同じ号・同じ画像を再度読み込んでも二重登録にはなりません。
          </p>
        </header>

        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-xl font-serif font-bold">印西市文化ホール（毎朝 自動）</h2>
            <p className="text-xs text-slate-500">
              文化ホール公式サイトの公演一覧・詳細・月別カレンダーを毎朝 06:20 に読み、今日以降の公演を自動で登録・更新します（AI は使いません）。
              チラシから手で登録済みのもの（同じ日・文化ホール・似た題名）は二重に載せず、そのまま残します。
              登録済み: {bunkaCount ?? 0} 件
            </p>
          </div>
          <InzaiBunkaSyncRuns runs={(bunkaRuns ?? []) as SyncRunRow[]} />
        </section>

        <section className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-8">
          <div className="space-y-1">
            <h2 className="text-xl font-serif font-bold">候補の自動取り込み（毎朝）</h2>
            <p className="text-xs text-slate-500">
              コスモスパレットの催しは公式サイトにほとんど載らないため、地域メディア「号外NET 印西版」「ちいき新聞」の記事を毎朝 06:25 に読み、
              市公式サイトの「イベント・お知らせ」カレンダーを 06:30 に読んで、題名・日時・会場・入場料・出典URLだけを候補（下書き）にします。
              記事の本文や写真は転記しません。下の候補を確認して「公開」か「見送り」を押してください。見送ったものは翌日以降も再登場しません。
            </p>
          </div>
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">号外NET・ちいき新聞（コスモスパレット）</p>
          <InzaiBunkaSyncRuns runs={(cosmosRuns ?? []) as SyncRunRow[]} subject="地域メディアの記事" unit="件" />
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 pt-2">市公式サイト（イベント・お知らせ）</p>
          <InzaiBunkaSyncRuns runs={(cityRuns ?? []) as SyncRunRow[]} subject="市サイト" unit="件" />
          <h3 className="text-sm font-semibold pt-2">確認待ちの候補 {cosmosCandidates.length} 件</h3>
          <CosmosCandidates candidates={cosmosCandidates} />
        </section>

        <section className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-8">
          <div className="space-y-1">
            <h2 className="text-xl font-serif font-bold">広報いんざいから取り込む</h2>
            <p className="text-xs text-slate-500">
              取り込み実績: {kouhouCount ?? 0} 件 ／ AI 読み取りの推定費用: 今月 {Math.round(scanCostMonth)} 円（{scanCallsMonth} 回）・累計 {Math.round(scanCostTotal)} 円
              <span className="ml-1 text-slate-400">（2026-09-16 から記録。1号は30ページを7ページずつ4〜5回に分けて読み、1回ごとに費用を残します）</span>
            </p>
          </div>
          <KouhouPdfImport />
        </section>

        <section className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-8">
          <div className="space-y-1">
            <h2 className="text-xl font-serif font-bold">チラシ画像から取り込む</h2>
            <p className="text-xs text-slate-500">取り込み実績: {flyerCount ?? 0} 件</p>
          </div>
          <BulkFlyerImport />
        </section>
      </div>
    </div>
  )
}
