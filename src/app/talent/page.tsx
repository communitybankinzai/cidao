import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { searchPublicProfiles } from '@/lib/talent-bank/profile/read'

// 2026-09-15 一本化：従来の公開PR（member_profiles_pr）は talent_profiles へ移し替えたので、一覧は新しい方だけを読む
export default async function TalentPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; area?: string }> }) {
  const filters = await searchParams
  const published = await searchPublicProfiles()
  const matching = filters.q || filters.tag || filters.area ? await searchPublicProfiles(filters) : published
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ids = matching.map(p => p.member_id)
  const { data: members } = ids.length ? await supabase.from('members').select('id, avatar_url, avatar_position, avatar_zoom').in('id', ids) : { data: [] }
  const avatars = new Map((members ?? []).map(m => [m.id, m]))

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
            <Link href="/me/talent"><Button variant="outline">自分の紹介を作る・直す</Button></Link>
          )}
        </header>

        <form action="/talent" className="grid gap-3 rounded-lg border bg-white dark:bg-slate-900 p-4 sm:grid-cols-2">
          <label className="text-sm">キーワード<input name="q" defaultValue={filters.q} placeholder="表示名・紹介・タグ" maxLength={100} className="mt-1 w-full rounded border bg-background p-2" /></label>
          <label className="text-sm">活動地域<input name="area" defaultValue={filters.area} placeholder="印西市・オンラインなど" maxLength={100} className="mt-1 w-full rounded border bg-background p-2" /></label>
          <label className="text-sm">タグ<select name="tag" defaultValue={filters.tag ?? ''} className="mt-1 w-full rounded border bg-background p-2"><option value="">すべて</option>{Array.from(new Map(published.flatMap(p => p.tags).map(t => [t.slug, t])).values()).map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}</select></label>
          <div className="flex items-end gap-3"><Button type="submit">検索</Button><Link href="/talent" className="text-sm underline">条件を解除</Link></div>
        </form>

        {matching.length === 0 ? (
          <p className="text-slate-400 text-center py-12">{published.length ? '条件に合う人はいませんでした' : '公開中の人材プロフィールはまだありません'}</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {matching.map(p => {
              const mem = avatars.get(p.member_id)
              return <li key={p.profile_id}><Link href={`/talent/${p.member_id}?subject=${p.subject_id}`} className="block h-full bg-white dark:bg-slate-900 border rounded-lg p-4 hover:border-slate-400">
                <div className="flex items-start gap-3">
                  <Avatar src={mem?.avatar_url ?? null} name={p.display_name} size="lg" objectPosition={mem?.avatar_position ?? undefined} zoom={mem?.avatar_zoom ?? undefined} />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold truncate">{p.display_name}</h2><p className="mt-1 text-sm line-clamp-3">{p.summary_short}</p>
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="タグ">{p.tags.slice(0, 3).map(t => <li key={t.id} className="rounded-full bg-muted px-2 py-1 text-xs">{t.label}</li>)}</ul>
                    <p className="mt-2 text-xs text-sky-600">詳細を見て声をかける →</p>
                  </div>
                </div>
              </Link></li>
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
