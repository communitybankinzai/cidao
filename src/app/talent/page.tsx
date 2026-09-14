import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { searchPublicProfiles, withoutPublishedLegacy } from '@/lib/talent-bank/profile/read'

export default async function TalentPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; area?: string }> }) {
  const filters = await searchParams
  const published = await searchPublicProfiles()
  const matching = filters.q || filters.tag || filters.area ? await searchPublicProfiles(filters) : published
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RLS により公開範囲に応じてフィルタされる
  const { data: legacy } = await supabase
    .from('member_profiles_pr')
    .select('member_id, qualifications, contributions, available_times, message_acceptance, members(display_name, skills_text, avatar_url, avatar_position, avatar_zoom)')
    .neq('message_acceptance', 'closed')
    .limit(50)

  const profiles = withoutPublishedLegacy(legacy ?? [], published).filter(p => {
    if (filters.tag || filters.area) return false // Legacy profiles have no structured tags or activity areas.
    if (!filters.q?.trim()) return true
    const member = Array.isArray(p.members) ? p.members[0] : p.members
    return [member?.display_name, member?.skills_text, p.contributions, p.qualifications].some(value =>
      value?.normalize('NFKC').toLocaleLowerCase().includes(filters.q!.normalize('NFKC').trim().toLocaleLowerCase()))
  })

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold">登録メンバー</h1>
            <p className="text-sm text-slate-500 mt-2">スキル・経験を活かしたい人と募集する人をつなぐ。AI と会話で探したい場合は <Link href="/match?mode=members" className="underline hover:text-slate-700 dark:hover:text-slate-300">マッチング相談</Link> をご利用ください。</p>
          </div>
          {user && (
            <div className="flex flex-wrap gap-2"><Link href="/me/pr"><Button variant="outline">自分のPRを編集</Button></Link><Link href="/talent/interview" className="text-sm underline">AIインタビューで登録（試行版）</Link></div>
          )}
        </header>

        <form action="/talent" className="grid gap-3 rounded-lg border bg-white dark:bg-slate-900 p-4 sm:grid-cols-2">
          <label className="text-sm">キーワード<input name="q" defaultValue={filters.q} placeholder="表示名・紹介・タグ" maxLength={100} className="mt-1 w-full rounded border bg-background p-2" /></label>
          <label className="text-sm">活動地域<input name="area" defaultValue={filters.area} placeholder="印西市・オンラインなど" maxLength={100} className="mt-1 w-full rounded border bg-background p-2" /></label>
          <label className="text-sm">タグ<select name="tag" defaultValue={filters.tag ?? ''} className="mt-1 w-full rounded border bg-background p-2"><option value="">すべて</option>{Array.from(new Map(published.flatMap(p => p.tags).map(t => [t.slug, t])).values()).map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}</select></label>
          <div className="flex items-end gap-3"><Button type="submit">検索</Button><Link href="/talent" className="text-sm underline">条件を解除</Link></div>
          {user && <Link href="/me/talent" className="text-sm underline">プロフィールの確認・編集</Link>}
        </form>

        {profiles.length === 0 && matching.length === 0 ? (
          <p className="text-slate-400 text-center py-12">公開中の人材プロフィールはまだありません</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {matching.map(p => <li key={p.profile_id}><Link href={`/talent/${p.member_id}?subject=${p.subject_id}`} className="block h-full bg-white dark:bg-slate-900 border rounded-lg p-4 hover:border-slate-400">
              <h2 className="font-semibold">{p.display_name}</h2><p className="mt-2 text-sm line-clamp-3">{p.summary_short}</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="タグ">{p.tags.slice(0, 3).map(t => <li key={t.id} className="rounded-full bg-muted px-2 py-1 text-xs">{t.label}</li>)}</ul>
              <p className="mt-2 text-xs text-sky-600">詳細を見て声をかける →</p>
            </Link></li>)}
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
