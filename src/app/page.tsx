import Link from 'next/link'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { summarize } from '@/lib/contribution-summary'
import { getCivicGroupCount } from '@/lib/org-count'

const SITE_URL = 'https://cidao.vercel.app'

const TIER_LABEL: Record<string, { label: string; color: string }> = {
  light:      { label: 'ライト登録',   color: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
  email_only: { label: '通常登録',     color: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200' },
  verified:   { label: '本人確認済み', color: 'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-200' },
}

export default async function Home() {
  const supabase = await createClient()

  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id ?? null
  } catch {
    // 未ログイン扱い
  }

  // 登録者数・団体数（システムアカウントは除外）
  const SYSTEM_MEMBER_IDS = [
    '943a665e-474d-46da-9f2d-a8cfa0f1bcaa', // 印西市公式登録（未認証プレースホルダー）
    '31f6bcf1-ce27-4825-a11c-591c5d3cd729', // イベント取込bot
  ]
  const [{ count: memberCount }, orgCount] = await Promise.all([
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .not('id', 'in', `(${SYSTEM_MEMBER_IDS.join(',')})`),
    getCivicGroupCount(supabase),
  ])

  // 会員証カード用データ（ログイン時のみ）
  let member: { tier: string; display_name: string; avatar_url: string | null; created_at: string } | null = null
  let qrDataUrl: string | null = null
  let contribTotal = 0
  let contribMonthly = 0
  let hasPr = false
  if (userId) {
    const { data: m } = await supabase
      .from('members')
      .select('tier, display_name, avatar_url, created_at')
      .eq('id', userId)
      .maybeSingle()
    member = m ?? null

    const { count: prCount } = await supabase
      .from('member_profiles_pr')
      .select('member_id', { count: 'exact', head: true })
      .eq('member_id', userId)
    hasPr = (prCount ?? 0) > 0

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
            CiDAO<span className="text-lg font-sans font-normal text-slate-400 ml-2">（シダオ）</span>
          </h1>
          <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">
            地域で「やってみたい」「手伝いたい」人と、協力を求める団体をつなぐ、印西市の無料の市民参加サービスです。
          </p>
          <details className="text-sm text-slate-600 dark:text-slate-400">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              くわしく見る
            </summary>
            <div className="mt-2 space-y-1.5 leading-relaxed bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-xs">
              <p>CiDAO でできることは、大きく3つです。</p>
              <ul className="list-disc list-inside space-y-1">
                <li>自分の得意なこと・興味を登録して、団体から活動の声がけを受け取る</li>
                <li>印西市内の市民活動団体やイベントを探して参加する</li>
                <li>まちへの提案を出したり、ほかの人の提案に投票したりする</li>
              </ul>
              <p className="pt-1 text-slate-500">
                名前の由来：DAO（ダオ）は「特定のリーダーではなく、参加する一人ひとりの意見で運営を決めていく仕組み」のこと。CiDAO は Citizen（市民）＋ DAO の造語です。
              </p>
            </div>
          </details>
        </header>

        {/* 初めての人向け：自分に合う入口を選ぶ（未ログイン時のみ） */}
        {!userId && (
          <section aria-label="はじめての方へ" className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Link
              href="/login?next=/me/pr"
              className="block bg-white dark:bg-slate-900 border-2 border-emerald-300 dark:border-emerald-700 rounded-lg p-4 hover:border-emerald-500 transition space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden>🙋</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  自分のスキルや経験を活かしたい
                </span>
              </div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                → あなたのPR（自己紹介）を作る
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                できること・興味のあることを登録すると、団体から活動の声がけが届きます。LINEログイン後、約3分で作れます。
              </p>
            </Link>
            <Link
              href="/orgs"
              className="block bg-white dark:bg-slate-900 border-2 border-sky-300 dark:border-sky-700 rounded-lg p-4 hover:border-sky-500 transition space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden>🔍</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  地域の活動や仲間を探したい
                </span>
              </div>
              <p className="text-sm font-semibold text-sky-700 dark:text-sky-300">
                → 活動・募集を探す
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                印西市内{orgCount ? ` ${orgCount} ` : 'の'}団体の情報とイベントを、登録なしでもそのまま見られます。
              </p>
            </Link>
          </section>
        )}

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

        {/* 次の一歩ガイド（ログイン済み・PR未作成の人向け） */}
        {member && !hasPr && (
          <section
            aria-label="次の一歩"
            className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 flex-wrap">
              <StepChip label="① 登録" state="done" />
              <span aria-hidden>→</span>
              <StepChip label={isLight ? '② プロフィール登録' : '② PR（自己紹介）を作る'} state="now" />
              <span aria-hidden>→</span>
              <StepChip label="③ 活動を探す" state="todo" />
            </div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              まずは、できること・興味があることを登録しましょう（約3分）
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              {isLight
                ? 'プロフィールで興味分野を選んで保存すると本登録が完了し、提案・投票・団体への応募ができるようになります。'
                : 'PR（自己紹介）を公開すると「登録メンバー」一覧に載り、団体から活動の声がけが届くようになります。'}
            </p>
            <Link href={isLight ? '/me/edit' : '/me/pr'}>
              <Button size="sm">{isLight ? 'プロフィールを登録する' : 'PR（自己紹介）を作る'}</Button>
            </Link>
          </section>
        )}

        <section className="bg-gradient-to-br from-emerald-50 to-sky-50 dark:from-emerald-950 dark:to-sky-950 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs tracking-[0.2em] text-emerald-700 dark:text-emerald-300 uppercase">Agent A7 · Match</div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">マッチング相談</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                AI（自動でおすすめを教えてくれる相談相手）と会話しながら、あなたに合う活動先や仲間を見つけられます
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
                印西市内{orgCount ? ` ${orgCount} ` : 'の'}団体から、活動可能な時間・関心に合う団体を AI が提案します。
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
                現在 {memberCount ?? '–'} 名が登録。声をかけたい人を AI が提案します。
              </p>
            </Link>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            自分の目で探したい方は{' '}
            <Link href="/orgs" className="underline hover:text-emerald-700 dark:hover:text-emerald-300">団体一覧・検索</Link>
            {' '}／{' '}
            <Link href="/talent" className="underline hover:text-emerald-700 dark:hover:text-emerald-300">メンバー一覧</Link>
            {' '}へ
          </p>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NavCard href="/proposals" label="提案・投票" />
          <NavCard href="/events"    label="イベント" />
          <NavCard href="/orgs"      label="団体一覧・検索" />
          <NavCard href="/talent"    label="登録メンバー" />
          <NavCard href="/freefree"  label="FreeFree" />
          <NavCard href="/ranking"   label="ランキング" />
        </section>

        <Link
          href="/install"
          className="block bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-lg p-3 hover:border-sky-400 transition text-center"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            📲 スマホのホーム画面に追加してアプリとして使う →
          </span>
        </Link>

        <footer className="flex gap-3">
          {userId ? (
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

function StepChip({ label, state }: { label: string; state: 'done' | 'now' | 'todo' }) {
  const cls =
    state === 'done'
      ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
      : state === 'now'
        ? 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 font-semibold'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
  return (
    <span className={`px-2 py-1 rounded ${cls}`}>
      {label}
      {state === 'done' && ' ✓'}
    </span>
  )
}

function NavCard({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 hover:border-slate-400 transition text-center">
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
    </Link>
  )
}
