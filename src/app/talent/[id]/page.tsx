import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'

export default async function TalentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: member } = await supabase
    .from('members')
    .select('display_name, skills_text, self_introduction, avatar_url, avatar_position, avatar_zoom')
    .eq('id', id)
    .single()
  if (!member) notFound()

  const { data: pr } = await supabase
    .from('member_profiles_pr')
    .select('*')
    .eq('member_id', id)
    .single()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/talent" className="hover:underline">← 人材バンク</Link></nav>
        <header className="flex items-center gap-4">
          <Avatar
            src={member.avatar_url}
            name={member.display_name}
            size="xl"
            objectPosition={member.avatar_position ?? undefined}
            zoom={member.avatar_zoom ?? undefined}
          />
          <h1 className="text-3xl font-serif font-bold">{member.display_name}</h1>
        </header>

        {member.skills_text && (
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
            <h2 className="text-xs font-semibold uppercase text-slate-500 mb-2">スキル</h2>
            <p className="text-sm">{member.skills_text}</p>
          </div>
        )}

        {pr && (
          <>
            {pr.qualifications && (
              <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
                <h2 className="text-xs font-semibold uppercase text-slate-500 mb-2">資格・経歴</h2>
                <p className="text-sm whitespace-pre-wrap">{pr.qualifications}</p>
              </div>
            )}
            {pr.contributions && (
              <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
                <h2 className="text-xs font-semibold uppercase text-slate-500 mb-2">できそうな貢献</h2>
                <p className="text-sm whitespace-pre-wrap">{pr.contributions}</p>
              </div>
            )}
            {pr.available_times && pr.available_times.length > 0 && (
              <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
                <h2 className="text-xs font-semibold uppercase text-slate-500 mb-2">対応可能時間</h2>
                <p className="text-sm">{pr.available_times.join(' / ')}</p>
              </div>
            )}
          </>
        )}

        {member.self_introduction && (
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
            <h2 className="text-xs font-semibold uppercase text-slate-500 mb-2">自己紹介</h2>
            <p className="text-sm whitespace-pre-wrap">{member.self_introduction}</p>
          </div>
        )}

        {user && user.id !== id && pr?.message_acceptance !== 'closed' && (
          <div className="bg-sky-50 dark:bg-sky-950 border rounded-lg p-6 text-center">
            <p className="text-sm mb-3">メッセージ送信機能は Step 11 で実装予定</p>
            <Button disabled>メッセージを送る（未実装）</Button>
          </div>
        )}
      </article>
    </div>
  )
}
