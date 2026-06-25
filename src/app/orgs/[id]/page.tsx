import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { categoryLabel } from '@/lib/categories'
import { requestJoinOrg, approveMembership } from '../actions'

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

        {org.description && (
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
            <p className="whitespace-pre-wrap">{org.description}</p>
          </div>
        )}

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
