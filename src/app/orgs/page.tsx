import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import OrgsBrowser from './_components/OrgsBrowser'

export default async function OrgsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, type, description, public_flag, organization_categories(category, is_primary)')
    .eq('public_flag', true)
    .order('name')
    .limit(200)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold">団体</h1>
          </div>
          {user && (
            <Link href="/orgs/new"><Button>団体登録</Button></Link>
          )}
        </header>

        <OrgsBrowser orgs={orgs ?? []} />
      </div>
    </div>
  )
}
