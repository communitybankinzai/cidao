import { createClient } from '@/lib/supabase/server'
import { BugReportForm } from './_components/BugReportForm'

export default async function BugReportPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>
}) {
  const { source } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-xl font-bold mb-2">不具合・ご要望の報告</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        CBIサイトやCiDAOアプリで気になった不具合・使いにくい点・ご要望をお寄せください。ログインしていなくても送信できます。
      </p>
      <BugReportForm
        source={source === 'cbi_site' ? 'cbi_site' : 'cidao_app'}
        isLoggedIn={!!user}
        defaultEmail={user?.email ?? ''}
      />
    </main>
  )
}
