import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { categoryLabel } from '@/lib/categories'
import { requestJoinOrg, approveMembership } from '../actions'

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
    .select('member_id, role, status, members(display_name)')
    .eq('org_id', id)
    .is('left_at', null)

  const myMembership = user ? members?.find((m) => m.member_id === user.id) : null
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
          ) : myMembership ? (
            <p className="text-sm">
              あなたは {myMembership.role}（{myMembership.status === 'confirmed' ? '承認済' : '申請中'}）として参加中
            </p>
          ) : (
            <form action={async () => { 'use server'; await requestJoinOrg(id) }}>
              <Button type="submit">参加を申請する</Button>
            </form>
          )}

          <div className="text-sm space-y-1">
            <p className="text-slate-500">メンバー（{confirmed.length}名）</p>
            {confirmed.slice(0, 20).map((m) => {
              const mem = Array.isArray(m.members) ? m.members[0] : m.members
              return <div key={m.member_id} className="text-xs">{mem?.display_name ?? '匿名'} <span className="text-slate-400">({m.role})</span></div>
            })}
          </div>
        </section>

        {isRepresentative && pending.length > 0 && (
          <section className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-4 rounded space-y-2">
            <h3 className="text-sm font-semibold">承認待ちの申請（{pending.length}）</h3>
            {pending.map((p) => {
              const mem = Array.isArray(p.members) ? p.members[0] : p.members
              return (
                <div key={p.member_id} className="flex justify-between items-center text-sm">
                  <span>{mem?.display_name ?? '匿名'}</span>
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
