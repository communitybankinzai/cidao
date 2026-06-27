import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/avatar'
import { ContactForm } from './_components/ContactForm'

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

  const { data: myTierRow } = user
    ? await supabase.from('members').select('tier').eq('id', user.id).single()
    : { data: null }
  const myTier = myTierRow?.tier ?? null

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

        {user?.id !== id && pr?.message_acceptance !== 'closed' && (
          <ContactForm
            targetMemberId={id}
            targetName={member.display_name}
            isLoggedIn={!!user}
            myTier={myTier}
            acceptanceMode={pr?.message_acceptance ?? null}
          />
        )}
        {user?.id !== id && pr?.message_acceptance === 'closed' && (
          <div className="bg-slate-50 dark:bg-slate-900 border rounded-lg p-4 text-center text-sm text-slate-500">
            このメンバーは現在メッセージを受け付けていません
          </div>
        )}

        {/* 本人が自分のページを見ているときのプレビュー */}
        {user?.id === id && (
          <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 rounded p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-amber-700 dark:text-amber-300 text-lg leading-none">👁️</span>
              <div className="flex-1 text-sm">
                <p className="font-semibold text-amber-900 dark:text-amber-100">
                  これはあなた自身の公開ページです（自分自身には送信できません）
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  他のメンバーがこのページを開いたときには、下のような『声をかけるフォーム』が表示されます。
                  {pr?.message_acceptance === 'closed' && (
                    <span className="block mt-1">
                      現在「受け付けない」設定中のため、他のメンバーには『現在メッセージを受け付けていません』とのみ表示されます。
                      <Link href="/me/pr" className="underline ml-1">設定を変更</Link>
                    </span>
                  )}
                </p>
              </div>
            </div>
            {pr?.message_acceptance !== 'closed' && (
              <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm space-y-2 opacity-90">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  ✉️ {member.display_name} さんに声をかける
                </p>
                <p className="text-xs text-slate-500">
                  送信ボタンを押すと、相手の登録メールアドレスにメッセージが届きます。返信はメールで直接やり取りできます。
                </p>
                <button
                  type="button"
                  disabled
                  className="text-xs px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 cursor-not-allowed"
                >
                  メッセージを書く（プレビュー）
                </button>
              </div>
            )}
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              受け取り設定の変更は <Link href="/me/pr" className="underline">マイページPR編集</Link> から。
            </p>
          </div>
        )}
      </article>
    </div>
  )
}
