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

        <Link
          href="/match"
          className="block bg-gradient-to-br from-emerald-50 to-sky-50 dark:from-emerald-950 dark:to-sky-950 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 hover:border-emerald-400 dark:hover:border-emerald-600 transition"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs tracking-[0.2em] text-emerald-700 dark:text-emerald-300 uppercase">Agent A7 · Match</div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">マッチング相談</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                印西市内 219 団体を把握した AI と会話して、あなたに合う活動を見つける
              </p>
            </div>
            <span className="text-2xl shrink-0">💬</span>
          </div>
        </Link>

        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NavCard href="/proposals" label="提案・投票" desc="F1-F3" />
          <NavCard href="/events"    label="イベント"   desc="F7" />
          <NavCard href="/orgs"      label="団体"       desc="F10" />
          <NavCard href="/talent"    label="人材バンク" desc="F13" />
          <NavCard href="/freefree"  label="FreeFree"   desc="F15" />
          <NavCard href="/ranking"   label="ランキング" desc="F4" />
        </section>

        <footer className="flex gap-3">
          {userEmail ? (
            <>
              <Link href="/me">
                <Button variant="default">マイページ</Button>
              </Link>
              <form action="/auth/sign-out" method="post">
                <Button type="submit" variant="outline">サインアウト</Button>
              </form>
            </>
          ) : (
            <Link href="/login">
              <Button variant="default">ログイン</Button>
            </Link>
          )}
        </footer>

        <p className="text-xs text-slate-400">
          Step 10 完了：MVP 18 機能群実装済 · 仕様書 v2.0 §3 準拠
        </p>
      </main>
    </div>
  )
}

function NavCard({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link href={href} className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 hover:border-slate-400 transition text-center">
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
      <div className="text-[10px] text-slate-400 mt-0.5">{desc}</div>
    </Link>
  )
}
