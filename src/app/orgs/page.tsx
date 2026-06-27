import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import OrgsBrowser from './_components/OrgsBrowser'

export default async function OrgsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, type, legal_form, description, public_flag, inzai_registration_number, organization_categories(category, is_primary)')
    .eq('public_flag', true)
    .order('name')
    .limit(200)

  // 公開メンバーシップ（display_in_org=true の confirmed）をまとめて取得して org_id でマップ
  type MembershipRow = {
    org_id: string
    member_id: string
    role: string
    status: string
    display_in_org: boolean
    members: { display_name: string; avatar_url: string | null } | { display_name: string; avatar_url: string | null }[] | null
  }
  const { data: memberships } = await supabase
    .from('memberships')
    .select('org_id, member_id, role, status, display_in_org, members!memberships_member_id_fkey(display_name, avatar_url)')
    .eq('status', 'confirmed')
    .eq('display_in_org', true)
    .is('left_at', null)

  const membersByOrgId = new Map<string, MembershipRow[]>()
  for (const m of (memberships ?? []) as MembershipRow[]) {
    const list = membersByOrgId.get(m.org_id) ?? []
    list.push(m)
    membersByOrgId.set(m.org_id, list)
  }
  const merged = (orgs ?? []).map((o) => ({
    ...o,
    memberships: membersByOrgId.get(o.id) ?? [],
  }))

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
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

        <OrgsBrowser orgs={merged} />
      </div>
    </div>
  )
}
