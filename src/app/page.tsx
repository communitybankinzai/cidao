import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'

export default async function Home() {
  const supabase = await createClient()

  let authStatus: 'ok' | 'error' = 'ok'
  let userEmail: string | null = null
  let authError: string | null = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error && error.name !== 'AuthSessionMissingError') {
      authStatus = 'error'
      authError = error.message
    }
    userEmail = data.user?.email ?? null
  } catch (e) {
    authStatus = 'error'
    authError = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-8">
      <main className="max-w-2xl w-full space-y-8">
        <header className="space-y-2">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">
            Citizen DAO · 市民DAO
          </p>
          <h1 className="text-4xl font-serif font-bold text-slate-900 dark:text-slate-100">
            CiDAO
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            印西市民による提案・投票・貢献度プラットフォーム
          </p>
        </header>

        <section className="border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4 bg-white dark:bg-slate-900">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            セットアップ状況
          </h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <dt className="text-slate-500">Next.js</dt>
            <dd className="text-slate-900 dark:text-slate-100 font-mono">running ✓</dd>

            <dt className="text-slate-500">Supabase Auth</dt>
            <dd className={authStatus === 'ok' ? 'text-emerald-600 font-mono' : 'text-red-600 font-mono'}>
              {authStatus === 'ok' ? 'reachable ✓' : `error: ${authError}`}
            </dd>

            <dt className="text-slate-500">ログイン状態</dt>
            <dd className="text-slate-900 dark:text-slate-100 font-mono">
              {userEmail ? `logged in as ${userEmail}` : 'not logged in'}
            </dd>
          </dl>
        </section>

        <footer className="flex gap-3">
          <Link href="/proposals">
            <Button variant="default">提案を見る</Button>
          </Link>
          {userEmail ? (
            <>
              <Link href="/me">
                <Button variant="outline">マイページ</Button>
              </Link>
              <form action="/auth/sign-out" method="post">
                <Button type="submit" variant="outline">サインアウト</Button>
              </form>
            </>
          ) : (
            <Link href="/login">
              <Button variant="outline">ログイン</Button>
            </Link>
          )}
        </footer>

        <p className="text-xs text-slate-400">
          Step 4: Next.js スキャフォールド完了 · 仕様書 v2.0 §2.3 準拠
        </p>
      </main>
    </div>
  )
}
