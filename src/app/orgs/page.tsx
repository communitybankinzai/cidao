import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import OrgsBrowser from './_components/OrgsBrowser'

export default async function OrgsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, type, legal_form, logo_url, description, public_flag, inzai_registration_number, representative_id, enriched_at, info_verified, created_at, updated_at, organization_categories(category, is_primary)')
    .eq('public_flag', true)
    .order('name')
    .limit(500)

  // 一括取り込み団体（seed-orgs.mjs）は代表者がシステムプレースホルダー会員になっている。
  // これを「仮登録」判定に使う（enriched_at は一括取り込みでは入らないため単独では判定不能）
  const { data: placeholderMember } = await supabase
    .from('members')
    .select('id')
    .eq('display_name', '印西市公式登録（未認証プレースホルダー）')
    .maybeSingle()
  const placeholderId = placeholderMember?.id ?? null

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
  // 登録状態の3区分（判定はサーバー側で確定させ、クライアントには結果だけ渡す）
  //   更新済み … 代表者が確認・編集済み（info_verified true）
  //   仮登録   … 未確認で、一括取り込み（代表者がプレースホルダー）or AI自動収集（enriched_at あり）
  //   新規登録 … それ以外＝ユーザー自身が団体登録フォームから登録
  const merged = (orgs ?? []).map((o) => {
    const status = o.info_verified
      ? 'verified' as const
      : ((placeholderId && o.representative_id === placeholderId) || o.enriched_at)
        ? 'provisional' as const
        : 'self_registered' as const
    return {
      ...o,
      status,
      memberships: membersByOrgId.get(o.id) ?? [],
    }
  })

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
