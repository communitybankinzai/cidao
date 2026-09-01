import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { BulkFlyerImport } from './_components/BulkFlyerImport'
import { KouhouPdfImport } from './_components/KouhouPdfImport'

export default async function AdminEventImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  // これまでこの画面から取り込んだ件数（COCoLa 経由分と区別して数える）
  const [{ count: flyerCount }, { count: kouhouCount }] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('external_source', 'cbi-admin-import'),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('external_source', 'cbi-kouhou-import'),
  ])

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
            <h2 className="text-xl font-serif font-bold">広報いんざいから取り込む</h2>
            <p className="text-xs text-slate-500">取り込み実績: {kouhouCount ?? 0} 件</p>
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
