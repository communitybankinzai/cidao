import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function AdminHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error } = await supabase.rpc('is_admin')
  if (error || !isAdmin) redirect('/')

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">管理画面</h1>
        </header>

        <ul className="grid gap-3 sm:grid-cols-2">
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
              href="/admin/claims"
              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
            >
              <h2 className="text-lg font-semibold mb-1">所属申告・新規団体キュー</h2>
              <p className="text-sm text-slate-500">所属申告の承認/却下、新規登録された団体の公開承認</p>
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
        </ul>
      </div>
    </div>
  )
}
