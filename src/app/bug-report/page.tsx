import { createClient } from '@/lib/supabase/server'
import { BugReportForm } from './_components/BugReportForm'

export default async function BugReportPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; ref?: string }>
}) {
  const { source, ref } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 通知の「この件について意見・不具合を送る」から来た場合、
  // どの通知についての報告かを本人の画面と運営側の記録に残す。
  // notifications は RLS で本人宛だけが読めるため、他人の通知は引けない
  let contextLabel: string | undefined
  if (ref && user) {
    const { data: n } = await supabase
      .from('notifications')
      .select('title')
      .eq('id', ref)
      .maybeSingle()
    if (n?.title) contextLabel = n.title
  }

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
        contextLabel={contextLabel}
        defaultPageUrl={contextLabel ? '/notifications' : ''}
      />
    </main>
  )
}
