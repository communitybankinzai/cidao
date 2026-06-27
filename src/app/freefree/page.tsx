import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { resolveFreefreePosterKind } from '@/lib/freefree-categories'
import FreefreeBrowser, { type FreefreeRow } from './_components/FreefreeBrowser'

export default async function FreefreePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: posts } = await supabase
    .from('freefree_posts')
    .select('id, title, body, category, location, created_at, expires_at, poster_type, poster_id')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(100)

  // org poster の場合、organizations.type と name を一括取得
  const orgIds = (posts ?? []).filter((p) => p.poster_type === 'org').map((p) => p.poster_id)
  const orgMap = new Map<string, { name: string; type: 'civic_group' | 'business' | 'government' }>()
  if (orgIds.length > 0) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name, type')
      .in('id', orgIds)
    ;(orgs ?? []).forEach((o) => orgMap.set(o.id, { name: o.name, type: o.type as 'civic_group' | 'business' | 'government' }))
  }

  const rows: FreefreeRow[] = (posts ?? []).map((p) => {
    const org = p.poster_type === 'org' ? orgMap.get(p.poster_id) : undefined
    return {
      id: p.id,
      title: p.title,
      body: p.body,
      category: p.category,
      location: p.location,
      created_at: p.created_at,
      expires_at: p.expires_at,
      posterKind: resolveFreefreePosterKind(p.poster_type, org?.type),
      orgName: org?.name ?? null,
    }
  })

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold">FreeFree 地域応援掲示板</h1>
            <p className="text-sm text-slate-500 mt-2">印西の小さなお店・個人事業・団体・企業・行政を応援</p>
          </div>
          {user && (
            <Link href="/freefree/new"><Button>掲載する</Button></Link>
          )}
        </header>

        <FreefreeBrowser rows={rows} />
      </div>
    </div>
  )
}
