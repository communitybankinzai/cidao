import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'

const TYPE_LABEL: Record<string, string> = {
  voluntary: '任意団体',
  civic: '市民活動団体',
  company: '企業',
  government: '行政',
}

export default async function OrgsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, type, description, public_flag')
    .eq('public_flag', true)
    .order('name')
    .limit(100)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
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

        {!orgs || orgs.length === 0 ? (
          <p className="text-slate-400 text-center py-12">団体はまだありません</p>
        ) : (
          <ul className="space-y-3">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/orgs/${o.id}`} className="block bg-white dark:bg-slate-900 border rounded-lg p-4 hover:border-slate-400">
                  <div className="flex justify-between mb-1">
                    <h2 className="text-lg font-semibold">{o.name}</h2>
                    <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{TYPE_LABEL[o.type]}</span>
                  </div>
                  {o.description && <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{o.description}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
