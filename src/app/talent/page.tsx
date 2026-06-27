import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'

export default async function TalentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RLS により公開範囲に応じてフィルタされる
  const { data: profiles } = await supabase
    .from('member_profiles_pr')
    .select('member_id, qualifications, contributions, available_times, message_acceptance, members(display_name, skills_text, avatar_url, avatar_position, avatar_zoom)')
    .neq('message_acceptance', 'closed')
    .limit(50)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold">人材バンク</h1>
            <p className="text-sm text-slate-500 mt-2">スキル・経験を活かしたい人と募集する人をつなぐ</p>
          </div>
          {user && (
            <Link href="/me/pr"><Button variant="outline">自分のPRを編集</Button></Link>
          )}
        </header>

        {!profiles || profiles.length === 0 ? (
          <p className="text-slate-400 text-center py-12">公開中の人材プロフィールはまだありません</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {profiles.map((p) => {
              const mem = (Array.isArray(p.members) ? p.members[0] : p.members) as
                | { display_name: string; skills_text: string | null; avatar_url: string | null; avatar_position: string | null; avatar_zoom: number | null }
                | null
              const name = mem?.display_name ?? '匿名'
              return (
                <li key={p.member_id}>
                  <Link href={`/talent/${p.member_id}`} className="block bg-white dark:bg-slate-900 border rounded-lg p-4 hover:border-slate-400">
                    <div className="flex items-start gap-3">
                      <Avatar
                        src={mem?.avatar_url ?? null}
                        name={name}
                        size="lg"
                        objectPosition={mem?.avatar_position ?? undefined}
                        zoom={mem?.avatar_zoom ?? undefined}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold mb-1 truncate">{name}</div>
                        {mem?.skills_text && <div className="text-xs text-slate-500 mb-2 line-clamp-2">{mem.skills_text}</div>}
                        {p.contributions && <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-3">{p.contributions}</p>}
                        <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-2">詳細を見て声をかける →</p>
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
