import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { categoryLabel } from '@/lib/categories'
import { canUserEditOrg } from '@/lib/org-permissions'
import { requestJoinOrg, approveMembership, verifyOrgInfo } from '../actions'

const SNS_LABEL: Record<string, string> = {
  x: 'X', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube',
  line: 'LINE', note: 'note', blog: 'ブログ',
}

const ROLE_LABEL: Record<string, string> = {
  representative: '代表',
  officer: '役員',
  member: '会員',
}

const TYPE_LABEL: Record<string, string> = {
  voluntary: '任意団体', civic: '市民活動団体', company: '企業', government: '行政',
}

export default async function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: org } = await supabase.from('organizations').select('*').eq('id', id).single()
  if (!org) notFound()

  const { data: cats } = await supabase
    .from('organization_categories')
    .select('category, is_primary')
    .eq('org_id', id)
    .order('is_primary', { ascending: false })

  const { data: members } = await supabase
    .from('memberships')
    .select('member_id, role, status, display_in_org, members!memberships_member_id_fkey(display_name, avatar_url)')
    .eq('org_id', id)
    .is('left_at', null)

  // 直近のイベント（前後3ヶ月の窓）。
  // 正規イベント（organizer_type='org' AND organizer_id = id）に加えて、
  // proxy 登録（organizer_name_text が当該団体名と一致）も含める。
  const now = new Date()
  const nowIso = now.toISOString()
  const pastWindowIso = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  const futureWindowIso = new Date(now.getTime() + 180 * 86_400_000).toISOString()
  const orgEventFilter = `and(organizer_type.eq.org,organizer_id.eq.${id}),and(proxy_registration.eq.true,organizer_name_text.eq.${org.name})`
  const { data: upcoming } = await supabase
    .from('events')
    .select('id, title, start_at, location, online_flag, category, proxy_registration')
    .or(orgEventFilter)
    .neq('status', 'draft')
    .gte('start_at', nowIso)
    .lt('start_at', futureWindowIso)
    .order('start_at', { ascending: true })
    .limit(8)
  const { data: recentPast } = await supabase
    .from('events')
    .select('id, title, start_at, location, online_flag, category, proxy_registration')
    .or(orgEventFilter)
    .neq('status', 'draft')
    .lt('start_at', nowIso)
    .gte('start_at', pastWindowIso)
    .order('start_at', { ascending: false })
    .limit(5)

  // 自分自身のメンバーシップは直接別クエリで取得（一覧側の表示制限や RLS の影響を回避）
  const { data: myMembershipRaw } = user
    ? await supabase
        .from('memberships')
        .select('role, status, left_at')
        .eq('org_id', id)
        .eq('member_id', user.id)
        .maybeSingle()
    : { data: null }
  const myActiveMembership =
    myMembershipRaw && myMembershipRaw.left_at === null ? myMembershipRaw : null
  const hasLeftBefore = !!(myMembershipRaw && myMembershipRaw.left_at !== null)
  const isRepresentative = org.representative_id === user?.id
  const pending = members?.filter((m) => m.status === 'claimed') ?? []
  const confirmed = members?.filter((m) => m.status === 'confirmed') ?? []

  // 編集権者か（自動拡充された provisional 情報の確認/修正ボタンの出し分け）
  const canEdit = user
    ? await canUserEditOrg(
        supabase,
        { id: org.id, representative_id: org.representative_id, contact_email: org.contact_email, name: org.name },
        user.id,
        user.email ?? null,
      )
    : false

  const snsEntries = org.sns_links && typeof org.sns_links === 'object'
    ? Object.entries(org.sns_links as Record<string, string>).filter(([, v]) => v)
    : []
  const isEnriched = !!org.enriched_at
  const isUnverified = isEnriched && !org.info_verified

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/orgs" className="hover:underline">← 団体一覧</Link></nav>

        <header className="space-y-3">
          <div className="flex gap-2 text-xs flex-wrap">
            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">{TYPE_LABEL[org.type]}</span>
            {org.inzai_registration_number && <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-950 rounded">登録 {org.inzai_registration_number}</span>}
            {cats?.map((c) => (
              <span key={c.category} className={`px-2 py-1 rounded ${c.is_primary ? 'bg-amber-100 dark:bg-amber-950' : 'bg-slate-100 dark:bg-slate-800'}`}>
                {categoryLabel(c.category)}
              </span>
            ))}
          </div>
          <h1 className="text-3xl font-serif font-bold">{org.name}</h1>
        </header>

        {(org.description || org.activity_detail) && (
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
            {isUnverified && (
              <div className="text-xs px-2 py-1 inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 rounded">
                <span>⚠️ 自動収集・未確認</span>
                <span className="text-amber-700/70 dark:text-amber-300/70">この情報は AI が Web から自動収集した暫定情報です。代表者の確認をお待ちしています。</span>
              </div>
            )}
            {org.activity_detail ? (
              <p className="whitespace-pre-wrap">{org.activity_detail}</p>
            ) : org.description ? (
              <p className="whitespace-pre-wrap">{org.description}</p>
            ) : null}
            {org.activity_detail && org.description && org.description.trim() !== org.activity_detail.trim() && (
              <details className="text-xs">
                <summary className="text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">登録時の簡易説明を見る</summary>
                <p className="whitespace-pre-wrap mt-2 text-slate-600 dark:text-slate-400">{org.description}</p>
              </details>
            )}

            {(org.website_url || snsEntries.length > 0 || org.activity_area || org.contact_email || org.contact_url) && (
              <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm pt-2 border-t border-slate-100 dark:border-slate-800">
                {org.website_url && (
                  <div>
                    <dt className="text-xs text-slate-500">公式サイト</dt>
                    <dd><a className="text-blue-600 hover:underline break-all" href={org.website_url} target="_blank" rel="noopener noreferrer">{org.website_url}</a></dd>
                  </div>
                )}
                {snsEntries.length > 0 && (
                  <div>
                    <dt className="text-xs text-slate-500">SNS</dt>
                    <dd className="flex flex-wrap gap-2">
                      {snsEntries.map(([k, v]) => (
                        <a key={k} className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-700" href={v} target="_blank" rel="noopener noreferrer">{SNS_LABEL[k] ?? k}</a>
                      ))}
                    </dd>
                  </div>
                )}
                {org.activity_area && (
                  <div>
                    <dt className="text-xs text-slate-500">活動エリア</dt>
                    <dd>{org.activity_area}</dd>
                  </div>
                )}
                {org.contact_email && (
                  <div>
                    <dt className="text-xs text-slate-500">連絡先メール</dt>
                    <dd className="break-all">{org.contact_email}</dd>
                  </div>
                )}
                {org.contact_url && (
                  <div>
                    <dt className="text-xs text-slate-500">問い合わせ</dt>
                    <dd><a className="text-blue-600 hover:underline break-all" href={org.contact_url} target="_blank" rel="noopener noreferrer">{org.contact_url}</a></dd>
                  </div>
                )}
              </dl>
            )}

            {isUnverified && canEdit && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                <form action={async () => { 'use server'; await verifyOrgInfo(org.id) }}>
                  <Button type="submit" size="sm" variant="secondary">この内容で正しい（確認する）</Button>
                </form>
                <Link href={`/orgs/${org.id}/edit`}>
                  <Button size="sm">情報を修正する</Button>
                </Link>
                <span className="text-xs text-slate-500 self-center">あなたはこの団体の編集権者です</span>
              </div>
            )}
            {isUnverified && !canEdit && user && (
              <p className="text-xs text-slate-500 pt-2">
                この団体の代表者・役員、または contact_email と同じメールでログインしている方は確認/修正できます。
              </p>
            )}
            {isEnriched && org.info_verified && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 代表者により確認済み</p>
            )}
            {canEdit && !isUnverified && (
              <div className="pt-2">
                <Link href={`/orgs/${org.id}/edit`} className="text-xs text-slate-500 hover:underline">団体情報を編集 →</Link>
              </div>
            )}
          </div>
        )}

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <div className="flex justify-between items-end">
            <h2 className="text-sm font-semibold uppercase text-slate-500">活動カレンダー</h2>
            <Link href="/events" className="text-xs text-slate-500 hover:underline">全イベントを見る →</Link>
          </div>
          {upcoming && upcoming.length > 0 ? (
            <ul className="space-y-2">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="flex justify-between items-baseline gap-3 text-sm border-l-2 border-amber-400 pl-3 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-r">
                    <span className="truncate">
                      {e.title}
                      {e.proxy_registration && <span className="ml-1 text-[10px] text-slate-400">(代理登録)</span>}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(e.start_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">直近の予定はまだありません</p>
          )}
          {recentPast && recentPast.length > 0 && (
            <details className="text-sm">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">過去3ヶ月の活動（{recentPast.length}件）</summary>
              <ul className="mt-2 space-y-1">
                {recentPast.map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="flex justify-between items-baseline gap-3 text-xs text-slate-600 dark:text-slate-400 hover:underline py-0.5">
                      <span className="truncate">{e.title}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        {new Date(e.start_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">参加 / 加入</h2>
          {!user ? (
            <Link href={`/login?next=/orgs/${id}`}><Button>ログイン</Button></Link>
          ) : myActiveMembership ? (
            <p className="text-sm">
              あなたは {ROLE_LABEL[myActiveMembership.role] ?? myActiveMembership.role}（{myActiveMembership.status === 'confirmed' ? '承認済' : '申請中'}）として参加中
            </p>
          ) : (
            <form action={async () => { 'use server'; await requestJoinOrg(id) }}>
              <Button type="submit">{hasLeftBefore ? '再加入を申請する' : '参加を申請する'}</Button>
            </form>
          )}

          <div className="space-y-2">
            <p className="text-sm text-slate-500">メンバー（{confirmed.length}名）</p>
            {confirmed.length === 0 ? (
              <p className="text-xs text-slate-400">まだメンバーがいません</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {confirmed
                  .filter((m) => m.display_in_org)
                  .slice(0, 30)
                  .map((m) => {
                    const mem = (Array.isArray(m.members) ? m.members[0] : m.members) as { display_name: string; avatar_url: string | null } | null
                    const name = mem?.display_name ?? '匿名'
                    return (
                      <li key={m.member_id} className="flex items-center gap-2 p-2 rounded border border-slate-100 dark:border-slate-800">
                        <Avatar src={mem?.avatar_url ?? null} name={name} size="md" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{name}</div>
                          <div className="text-[10px] text-slate-500">{ROLE_LABEL[m.role] ?? m.role}</div>
                        </div>
                      </li>
                    )
                  })}
              </ul>
            )}
          </div>
        </section>

        {isRepresentative && pending.length > 0 && (
          <section className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-4 rounded space-y-2">
            <h3 className="text-sm font-semibold">承認待ちの申請（{pending.length}）</h3>
            {pending.map((p) => {
              const mem = (Array.isArray(p.members) ? p.members[0] : p.members) as { display_name: string; avatar_url: string | null } | null
              const name = mem?.display_name ?? '匿名'
              return (
                <div key={p.member_id} className="flex justify-between items-center text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar src={mem?.avatar_url ?? null} name={name} size="sm" />
                    <span className="truncate">{name}</span>
                  </div>
                  <form action={async () => { 'use server'; await approveMembership(id, p.member_id) }}>
                    <Button type="submit" size="sm">承認</Button>
                  </form>
                </div>
              )
            })}
          </section>
        )}
      </article>
    </div>
  )
}
