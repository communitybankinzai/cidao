import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { approveClaim, rejectClaim } from '../../orgs/actions'

const ROLE_LABEL: Record<string, string> = {
  representative: '代表者',
  officer: '役員',
  member: '会員',
}

export default async function AdminClaimsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const { data: claims } = await supabase
    .from('memberships')
    .select(
      'org_id, member_id, role, status, joined_at, organizations(id, name, type, representative_id, public_flag), members(display_name, residency_type, self_introduction)',
    )
    .eq('status', 'claimed')
    .is('left_at', null)
    .order('joined_at', { ascending: false })

  type Row = NonNullable<typeof claims>[number]
  const rows = (claims ?? []) as Row[]

  async function handleApprove(formData: FormData) {
    'use server'
    const orgId = String(formData.get('org_id') ?? '')
    const memberId = String(formData.get('member_id') ?? '')
    if (orgId && memberId) await approveClaim(orgId, memberId)
  }

  async function handleReject(formData: FormData) {
    'use server'
    const orgId = String(formData.get('org_id') ?? '')
    const memberId = String(formData.get('member_id') ?? '')
    if (orgId && memberId) await rejectClaim(orgId, memberId)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">所属申告キュー</h1>
          <p className="text-xs text-slate-500">
            メンバーが /me/edit から申告した所属団体（status=claimed）の承認・却下。代表者承認時、対象団体に既存代表者がいなければ <code className="text-[10px]">organizations.representative_id</code> を自動更新する。
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="text-slate-400 text-center py-12">承認待ちの申告はありません</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((c) => {
              const org = c.organizations as unknown as { id: string; name: string; type: string; representative_id: string | null; public_flag: boolean } | null
              const m = c.members as unknown as { display_name: string; residency_type: string; self_introduction: string | null } | null
              const hasExistingRep = !!org?.representative_id
              const isRepClaim = c.role === 'representative'
              const isNewOrg = org ? !org.public_flag : false
              return (
                <li
                  key={`${c.org_id}:${c.member_id}`}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-sm font-semibold">
                        {m?.display_name ?? '(unknown member)'}
                        <span className="text-xs font-normal text-slate-500">
                          {' → '}
                          {org ? (
                            <Link href={`/orgs/${org.id}`} className="hover:underline">{org.name}</Link>
                          ) : (
                            '(team unknown)'
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[10px]">
                        {isNewOrg && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 font-semibold">
                            🆕 新規団体（承認で公開）
                          </span>
                        )}
                        <span
                          className={
                            'px-1.5 py-0.5 rounded font-semibold ' +
                            (isRepClaim
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
                          }
                        >
                          申告ロール: {ROLE_LABEL[c.role] ?? c.role}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          居住: {m?.residency_type === 'citizen' ? '市民' : '関係人口'}
                        </span>
                        {isRepClaim && hasExistingRep && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                            ⚠ 既に代表者が登録されている団体です
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                          申請: {new Date(c.joined_at).toLocaleDateString('ja-JP')}
                        </span>
                      </div>
                      {m?.self_introduction && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-1">
                          {m.self_introduction}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <form action={handleApprove}>
                        <input type="hidden" name="org_id" value={c.org_id} />
                        <input type="hidden" name="member_id" value={c.member_id} />
                        <Button type="submit" className="w-full">承認</Button>
                      </form>
                      <form action={handleReject}>
                        <input type="hidden" name="org_id" value={c.org_id} />
                        <input type="hidden" name="member_id" value={c.member_id} />
                        <Button type="submit" variant="outline" className="w-full">却下</Button>
                      </form>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
