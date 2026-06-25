import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { freefreeCategoryLabel } from '@/lib/freefree-categories'

export default async function FreefreePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: posts } = await supabase
    .from('freefree_posts')
    .select('id, title, body, category, location, created_at, expires_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold">FreeFree 地域応援掲示板</h1>
            <p className="text-sm text-slate-500 mt-2">印西の小さなお店・個人事業・イベントを応援</p>
          </div>
          {user && (
            <Link href="/freefree/new"><Button>掲載する</Button></Link>
          )}
        </header>

        {!posts || posts.length === 0 ? (
          <p className="text-slate-400 text-center py-12">まだ掲載はありません</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {posts.map((p) => (
              <li key={p.id}>
                <Link href={`/freefree/${p.id}`} className="block bg-white dark:bg-slate-900 border rounded-lg p-4 hover:border-slate-400">
                  <div className="text-xs text-slate-500 mb-1">{freefreeCategoryLabel(p.category)}</div>
                  <div className="font-semibold mb-1">{p.title}</div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{p.body}</p>
                  {p.location && <div className="text-xs text-slate-500 mt-2">📍 {p.location}</div>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
