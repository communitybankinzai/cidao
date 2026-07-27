import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { BulkFlyerImport } from './_components/BulkFlyerImport'

export default async function AdminEventImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  // これまでこの画面から取り込んだ件数（COCoLa 経由分と区別して数える）
  const { count: importedCount } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('external_source', 'cbi-admin-import')

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
          <Link href="/admin/events" className="hover:underline">イベント参加者一覧</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">チラシ一括取り込み</h1>
          <p className="text-xs text-slate-500">
            集めたチラシ画像をまとめてアップロードすると、AIが日時・場所・主催者を読み取ります。
            内容を確認・修正してから登録できます。同じ画像を再度アップロードしても二重登録にはなりません。
          </p>
          <p className="text-xs text-slate-500">
            この画面からの取り込み実績: {importedCount ?? 0} 件
          </p>
        </header>

        <BulkFlyerImport />
      </div>
    </div>
  )
}
