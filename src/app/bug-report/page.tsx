import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { BugReportForm } from './_components/BugReportForm'

export default async function BugReportPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; ref?: string; category?: string; about?: string }>
}) {
  const { source, ref, category, about } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 相談の入口（提案を書く画面・ヘルプ）から来た場合：種別を「使い方の質問・相談」にし、話題を本文の先頭に入れる
  const TOPICS: Record<string, string> = { proposal: '提案の書き方', freefree: 'FreeFree掲示板の使い方', event: 'イベントの登録' }
  const topicLabel = about ? TOPICS[about] : undefined
  const defaultCategory = category === 'question' || topicLabel ? ('question' as const) : undefined

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
    <PageShell feature="help" width="narrow">
      <PageHeader feature="help"
        title="運営に相談・不具合を知らせる"
        description="使い方の質問や相談（提案の書き方など）、不具合、ご要望をお寄せください。ログインしていれば、運営の返事は画面右上のベル🔔に届きます。ログインしていなくても送信できます。"
      />
      <BugReportForm
        source={source === 'cbi_site' ? 'cbi_site' : 'cidao_app'}
        isLoggedIn={!!user}
        defaultEmail={user?.email ?? ''}
        contextLabel={contextLabel}
        topicLabel={topicLabel}
        defaultCategory={defaultCategory}
        defaultPageUrl={contextLabel ? '/notifications' : ''}
      />
    </PageShell>
  )
}
