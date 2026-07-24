import Link from 'next/link'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { summarize } from '@/lib/contribution-summary'

const SITE_URL = 'https://cidao.vercel.app'

const TIER_LABEL: Record<string, { label: string; color: string }> = {
  light:      { label: 'ライト登録',   color: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
  email_only: { label: '通常登録',     color: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200' },
  verified:   { label: '本人確認済み', color: 'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-200' },
}

export default async function Home() {
  const supabase = await createClient()

  let userEmail: string | null = null
  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getUser()
    userEmail = data.user?.email ?? null
    userId = data.user?.id ?? null
  } catch {
    // 未ログイン扱い
  }

  // 会員証カード用データ（ログイン時のみ）
  let member: { tier: string; display_name: string; avatar_url: string | null; created_at: string } | null = null
  let qrDataUrl: string | null = null
  let contribTotal = 0
  let contribMonthly = 0
  if (userId) {
    const { data: m } = await supabase
      .from('members')
      .select('tier, display_name, avatar_url, created_at')
      .eq('id', userId)
      .maybeSingle()
    member = m ?? null

    if (member) {
      qrDataUrl = await QRCode.toDataURL(`${SITE_URL}/talent/${userId}`, {
        margin: 1,
        width: 240,
        color: { dark: '#1e293b', light: '#ffffff' },
      })
      const { data: contributions } = await supabase
        .from('contributions')
        .select('action_type, pt, created_at')
        .eq('actor_id', userId)
        .order('created_at', { ascending: false })
        .limit(200)
      const summary = summarize(contributions ?? [])
      contribTotal = summary.total
      contribMonthly = summary.monthlyTotal
    }
  }
  const isLight = member?.tier === 'light'
  const tierInfo = member ? (TIER_LABEL[member.tier] ?? TIER_LABEL.light) : null

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

        {member && tierInfo && (
          <section aria-label="会員証" className="space-y-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
              <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                <span className="text-[10px] tracking-[0.25em] text-slate-400 uppercase">CiDAO Member</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tierInfo.color}`}>
                  {tierInfo.label}
                </span>
              </div>
              <div className="p-5 flex items-center gap-5">
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar src={member.avatar_url} name={member.display_name} size="md" />
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {member.display_name}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        登録: {new Date(member.created_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long' })}
                      </div>
                    </div>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-slate-50 dark:bg-slate-800 py-2">
                      <dt className="text-[10px] text-slate-500">貢献度 累計</dt>
                      <dd className="text-sm font-semibold tabular-nums">{contribTotal} pt</dd>
                    </div>
                    <div className="rounded bg-slate-50 dark:bg-slate-800 py-2">
                      <dt className="text-[10px] text-slate-500">今月</dt>
                      <dd className="text-sm font-semibold tabular-nums">{contribMonthly} pt</dd>
                    </div>
                    <div className="rounded bg-slate-50 dark:bg-slate-800 py-2">
                      <dt className="text-[10px] text-slate-500">地域通貨</dt>
                      <dd className="text-[11px] text-slate-400 pt-0.5">準備中</dd>
                    </div>
                  </dl>
                </div>
                {qrDataUrl && (
                  <div className="shrink-0 text-center space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrDataUrl}
                      alt="会員識別QRコード（プロフィールページへのリンク）"
                      width={96}
                      height={96}
                      className="rounded border border-slate-200 dark:border-slate-700"
                    />
                    <p className="text-[9px] text-slate-400">会員QR</p>
                  </div>
                )}
              </div>
            </div>
            {isLight && (
              <p className="text-xs text-slate-400">
                ライト登録では提案・投票・団体への応募・メンバーへのコンタクトはできません。{' '}
                <Link href="/me/edit" className="underline hover:text-slate-600 dark:hover:text-slate-300">
                  プロフィールを完成させて本登録する →
                </Link>
              </p>
            )}
          </section>
        )}

        <section className="bg-gradient-to-br from-emerald-50 to-sky-50 dark:from-emerald-950 dark:to-sky-950 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs tracking-[0.2em] text-emerald-700 dark:text-emerald-300 uppercase">Agent A7 · Match</div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">マッチング相談</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                AI と会話して、あなたに合う活動先や仲間を見つける
              </p>
            </div>
            <span className="text-2xl shrink-0" aria-hidden>💬</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <Link
              href="/match"
              className="block bg-white/70 dark:bg-slate-900/60 border border-emerald-200/60 dark:border-emerald-800/60 rounded-md p-3 hover:border-emerald-400 dark:hover:border-emerald-600 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>🏛️</span>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">団体を探す</h4>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                印西市内 219 団体から、活動可能な時間・関心に合う団体を AI が提案します。
              </p>
            </Link>
            <Link
              href="/match?mode=members"
              className="block bg-white/70 dark:bg-slate-900/60 border border-emerald-200/60 dark:border-emerald-800/60 rounded-md p-3 hover:border-emerald-400 dark:hover:border-emerald-600 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>🤝</span>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">メンバーを探す</h4>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                登録メンバーの中から、声をかけたい人を AI が提案します。
              </p>
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NavCard href="/proposals" label="提案・投票" />
          <NavCard href="/events"    label="イベント" />
          <NavCard href="/orgs"      label="団体" />
          <NavCard href="/talent"    label="登録メンバー" />
          <NavCard href="/freefree"  label="FreeFree" />
          <NavCard href="/ranking"   label="ランキング" />
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
      </main>
    </div>
  )
}

function NavCard({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 hover:border-slate-400 transition text-center">
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
    </Link>
  )
}
