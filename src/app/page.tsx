import Link from 'next/link'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { summarize } from '@/lib/contribution-summary'
import { getCivicGroupCount } from '@/lib/org-count'
import { openProposalsNote } from '@/lib/proposal-open-note'
import { PushNudge } from '@/components/PushNudge'
import { PageShell } from '@/components/layout/PageShell'
import { PillLink, PillRow, RoundLink, RoundRow, Tile, TileGrid } from '@/components/Tile'
import { HomeTileEffects, NewDot } from '@/components/HomeTileEffects'
import { MemberQr } from '@/components/MemberQr'
import { DISASTER_MAP_URL, GOURMET_MAP_URL, METAVERSE_URL } from '@/lib/cbi-site-urls'
import {
  Building2,
  CalendarDays,
  CircleHelp,
  Hospital,
  Lightbulb,
  LogIn,
  Map as MapIcon,
  Megaphone,
  ShieldAlert,
  Smartphone,
  UserRound,
  Users,
  Utensils,
  Vote,
} from 'lucide-react'
import { SYSTEM_MEMBER_IDS } from '@/lib/org-placeholder'

const SITE_URL = 'https://cidao.vercel.app'

/** 初めての端末で「新着の印」を出す日数（この日数より新しい投稿があれば出す） */
const NEW_DOT_DAYS = 3

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

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
  // 新着の印（掲示板・イベントのタイル）用に、いちばん新しい投稿の時刻も1件ずつ読む。条件は各一覧ページと同じ
  const now = new Date()
  const nowIso = now.toISOString()
  // 「提案・投票」タイルの件数（投票中・議論中）用に、参加できる提案の状態だけを読む（数件・ほかの読み取りと同時）
  const [{ count: memberCount }, orgCount, { data: latestPost }, { data: latestEvent }, { data: openProposals }] = await Promise.all([
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .not('id', 'in', `(${SYSTEM_MEMBER_IDS.join(',')})`),
    getCivicGroupCount(supabase),
    supabase
      .from('freefree_posts')
      .select('created_at')
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('events')
      .select('created_at')
      .neq('status', 'draft')
      .gt('end_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('proposals').select('status, voting_end_at').in('status', ['voting', 'discussion']).limit(100),
  ])
  const proposalsNote = openProposalsNote(openProposals, now.getTime())
  const newSince = now.getTime() - NEW_DOT_DAYS * 86400_000
  const latestPostAt = toMs(latestPost?.created_at)
  const latestEventAt = toMs(latestEvent?.created_at)

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
        width: 600,
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

  // ホームのボタンは3段（2026-11-23 事業主決定・A案）。段ごとに形を変えて、色が見えにくくても見分けられるようにする
  // 上段：自分のこと・困ったときの入口。ログイン前も後も、見出しのすぐ下（会員証より上）に置く
  // 会員の画面では、右上に連絡・管理・通知ベルのボタンが固定で浮いている（layout.tsx。top-3・高さ40px・右から最大148px）。
  // 会員証の帯を横いっぱいに一番上へ置いたら、帯の右側（登録の種類・QR）にこの3つが重なった（2026-11-25 事業主の指摘）。
  // そこで会員の画面では、上段を小さい形にして3つのボタンと同じ行の左へ置き、帯はそのすぐ下にした（同日・事業主決定）。
  // それでも画面を少し下へ動かすと、会員証が3つのボタンの下にもぐって重なった（3つは画面に貼りついたまま・同日の2度目の指摘）。
  // そこでこの行を、下へ動かしても画面の上に残る帯（背景つき・横いっぱい）にした。会員証は帯の下に隠れる（同日・事業主決定A）
  const isMemberView = Boolean(member && tierInfo)
  const topRow = (
    <PillRow label="マイページと使い方" compact={isMemberView}>
      {userId ? (
        <PillLink href="/me" icon={UserRound} label="マイページ" solid compact={isMemberView} />
      ) : (
        <PillLink href="/login" icon={LogIn} label="ログイン" solid />
      )}
      <PillLink href="/help" icon={CircleHelp} label="使い方" compact={isMemberView} />
    </PillRow>
  )

  // 中段・下段。ログイン前も後も、上段の直下に置く。
  // 2026-11-25 事業主決定（「スマホで開いた最初の画面でボタンがすべて画面内に入っているとよい」）：
  // それまでログイン後は会員証の下に置いていたが、会員の画面では最初の画面に上段の2つしか入らなかった。
  // 通知の案内・次の一歩はボタンの下へ移し、すき間とボタンの高さも詰めた（PageShell の dense・Tile.tsx）。
  // 会員証は、同じ日のうちに細い帯にして一番上（見出しの代わり）へ戻した（下の return の先頭）
  const tiles = (
    <section aria-label="できること" className="space-y-2">
      {/* 中段：CiDAO の主な機能。色は各ページの見出しと同じ（features.ts） */}
      <div className="space-y-2 [--stagger-base:120ms]">
        <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400">CiDAOでできること</h2>
        {/* 並び（2026-11-23 事業主決定）：提案・投票は横いっぱい／団体・人材は同じ行／イベント・掲示板は同じ行。
            色（同日・案1）：中段は濃い塗り（solid）、下段は線だけの丸。主な機能のほうを目立たせる
            名前（2026-11-25 事業主決定）：項目の名前だけでなく、行動を伴う言い方にする（提案・投票する／イベントを見る・登録する／掲示板で伝える）。
            文字は16px（同日・事業主決定）。いちばん長い「イベントを見る・登録する」は幅375px以上で1行、それより狭いと「・」の後ろで折れて2行（Tile の LabelText） */}
        <TileGrid label="CiDAOでできること" cols={6}>
          <Tile href="/proposals" icon={Vote} label="提案・投票する" color="indigo" span={6} note={proposalsNote} solid />
          <Tile href="/orgs" icon={Building2} label="団体をさがす" color="emerald" span={3} solid />
          <Tile href="/talent" icon={Users} label="人材をさがす" color="violet" span={3} solid />
          <Tile
            href="/events"
            icon={CalendarDays}
            label="イベントを見る・登録する"
            color="orange"
            span={3}
            solid
            seenKey="events"
            badge={<NewDot seenKey="events" latestAt={latestEventAt} recent={latestEventAt !== null && latestEventAt > newSince} />}
          />
          <Tile
            href="/freefree"
            icon={Megaphone}
            label="掲示板で伝える"
            color="amber"
            span={3}
            solid
            seenKey="freefree"
            badge={<NewDot seenKey="freefree" latestAt={latestPostAt} recent={latestPostAt !== null && latestPostAt > newSince} />}
          />
        </TileGrid>
      </div>
      {/* 下段：「あったらいいな」を形にした実例。丸い形で、主な機能と別のものだと分かるようにする */}
      <div className="space-y-2 pt-1 [--stagger-base:420ms]">
        <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400">「あったらいいな」を形にしました</h2>
        <RoundRow label="「あったらいいな」を形にした実例">
          {/* 3Dマップ（CBI サイトの3Dワールド）。CiDAO の外なので新しいタブで開く */}
          <RoundLink href={METAVERSE_URL} icon={MapIcon} label="3Dマップ" color="blue" external track="3dmap" />
          {/* 食レポマップ（CBI サイト・2026-11-13）。名前は事業主の希望で短く「ぐるめ」 */}
          <RoundLink href={GOURMET_MAP_URL} icon={Utensils} label="ぐるめ" color="rose" external track="gourmet" />
          {/* 防災マップ（CBI サイト・2026-11-13）。事業主の指示で「ぐるめ」の後ろ（防災は主役ではない） */}
          <RoundLink href={DISASTER_MAP_URL} icon={ShieldAlert} label="防災" color="yellow" external track="bousai" />
          {/* 病院マップ（2026-11-23）。休日に病院を探して困る人のため */}
          <RoundLink href="/hospitals" icon={Hospital} label="病院" color="teal" track="hospitals" />
        </RoundRow>
        {/* 実例を見た人を、次の「あったらいいな」の提案へつなぐ（2026-11-23 事業主決定）。未ログインはログイン後に投稿画面へ */}
        <Link
          href="/proposals/new"
          prefetch={false}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-800 transition hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
        >
          <Lightbulb aria-hidden className="size-4" />
          あなたの「あったらいいな」を送る
        </Link>
      </div>
      {orgCount || memberCount ? (
        <p className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-center text-sm text-slate-600 dark:text-slate-300">
          {orgCount ? (
            <span className="whitespace-nowrap">
              市民活動団体 <b className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{orgCount}</b> 件
            </span>
          ) : null}
          {memberCount ? (
            <span className="whitespace-nowrap">
              登録メンバー <b className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{memberCount}</b> 名
            </span>
          ) : null}
          <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">（印西市内）</span>
        </p>
      ) : null}
    </section>
  )

  return (
    <PageShell width="narrow" dense topBarRow={isMemberView}>
        {member && tierInfo ? (
          <>
          {/* 画面の上に残る帯。高さは 上の余白12＋ボタン40＋下の余白8＝60px で、右上の3つのボタン（上から12〜52px）がこの帯の中に収まる。
             背景はページと同じ色で不透明（下を通る会員証を隠すため。透けさせない）。z は右上のボタン（z-50）より下・本文より上。
             mb-0 は main の段のすき間（space-y）を打ち消して、会員証を帯のすぐ下（上から60px）に置くため。
             パソコンの幅では PageShell の上の余白（48px）が残るので、md:-mt-3 で開いた直後の位置をそろえる */}
          <div className="sticky top-0 z-40 -mx-4 mb-0 bg-slate-50 px-4 pt-3 pb-2 md:-mt-3 dark:bg-slate-950">
            {topRow}
          </div>
          {/* 会員の画面：見出しの代わりに、上段（小さい形）の行と、会員証の細い帯を置く（2026-11-25 事業主決定「メンバーカードは一番上がいい」）。
             前の会員証は高さ約223pxあり、上に置くとボタンが最初の画面から押し出された。帯は約65px。
             「CiDAO」は帯の中に入れ（h1）、大きい見出しの行は出さない。QR は押すと大きく出る（MemberQr）。
             登録した月・「地域通貨 準備中」の箱は帯には入れていない。名前・貢献度は1行で、長いときは末尾を省く（高さを変えないため） */}
          <section aria-label="会員証">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <Avatar src={member.avatar_url} name={member.display_name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <h1 className="font-serif text-[15px] font-bold leading-none text-slate-900 dark:text-slate-100">CiDAO</h1>
                  <span className="truncate text-[10px] uppercase tracking-[0.25em] text-slate-400">Member</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${tierInfo.color}`}>
                    {tierInfo.label}
                  </span>
                </div>
                <div className="truncate text-lg font-bold leading-[22px] text-slate-900 dark:text-slate-100">{member.display_name}</div>
                <div className="truncate text-[11px] leading-[14px] tabular-nums text-slate-500 dark:text-slate-400">
                  貢献度 累計 {contribTotal} pt ・ 今月 {contribMonthly} pt
                </div>
              </div>
              {qrDataUrl && <MemberQr src={qrDataUrl} name={member.display_name} />}
            </div>
          </section>
          </>
        ) : (
        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">
            Citizen DAO · 市民DAO
          </p>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-900 dark:text-slate-100">
            CiDAO<span className="text-lg font-sans font-normal text-slate-400 ml-2">（シダオ）</span>
          </h1>
          {/* 説明文は、はじめての人（ログイン前）にだけ出す。1行に短くして、全文は「くわしく見る」の中へ（2026-11-25）。
              会員の画面では出さない（ボタンを最初の画面に入れるため） */}
          {!userId && (
          <>
          <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">
            印西市の、無料の市民参加サービスです。
          </p>
          <details className="text-sm text-slate-600 dark:text-slate-400">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              くわしく見る
            </summary>
            <div className="mt-2 space-y-1.5 leading-relaxed bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-xs">
              <p>地域で「やってみたい」「手伝いたい」人と、協力を求める団体をつなぐ、印西市の無料の市民参加サービスです。</p>
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
          </>
          )}
        </header>
        )}

        <HomeTileEffects />
        {!isMemberView && topRow}

        {tiles}

        {/* 初めての人向け：自分に合う入口を選ぶ（未ログイン時のみ） */}
        {!userId && (
          <section aria-label="はじめての方へ" className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">はじめての方へ</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Link
              href="/login?next=/me/talent"
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
                印西市内{orgCount ? `の市民活動団体 ${orgCount} 件` : 'の団体'}の情報とイベントを、登録なしでもそのまま見られます。
              </p>
            </Link>
            </div>
          </section>
        )}

        {/* ライト登録の人への注意書き（会員証を帯にして一番上へ移したので、ここに残した） */}
        {isLight && (
          <p className="text-xs text-slate-400">
            ライト登録では提案・投票・団体への応募・メンバーへのコンタクトはできません。{' '}
            <Link href="/me/edit" className="underline hover:text-slate-600 dark:hover:text-slate-300">
              プロフィールを完成させて本登録する →
            </Link>
          </p>
        )}

        {/* プッシュ通知の購読案内（ログイン済み・未購読の人だけに表示） */}
        {member && <PushNudge />}

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
                ? 'プロフィールを確認して保存すると本登録が完了し、提案・投票・団体への応募ができるようになります。興味分野は選ばなくても進めます。'
                : '人材バンクで紹介文を作って公開を申請し、運営が確認すると「登録メンバー」一覧に載り、団体から活動の声がけが届くようになります。'}
            </p>
            <Link href={isLight ? '/me/edit' : '/me/talent'}>
              <Button size="sm">{isLight ? 'プロフィールを登録する' : 'PR（自己紹介）を作る'}</Button>
            </Link>
          </section>
        )}

        <Link
          href="/install"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <Smartphone aria-hidden className="size-4" />
          スマホのホーム画面に追加して、アプリのように使う
        </Link>

        <footer className="flex gap-3">
          {userId ? (
            <>
              <form action="/auth/sign-out" method="post">
                <Button type="submit" variant="outline">サインアウト</Button>
              </form>
            </>
          ) : (
            <Link href="/login">
              <Button variant="default" className="h-11 px-6 text-base">ログイン（LINEで無料）</Button>
            </Link>
          )}
        </footer>
    </PageShell>
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
