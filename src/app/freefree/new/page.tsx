import { redirect, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FREEFREE_CATEGORIES, FREEFREE_POSTER_KINDS, type FreefreePosterKind } from '@/lib/freefree-categories'
import { createFreefreePost } from '../actions'
import NewFreefreeForm from './_components/NewFreefreeForm'

type EditableOrg = { id: string; name: string; type: 'civic_group' | 'business' | 'government' }

export default async function NewFreefreePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/freefree/new')

  // 自分が代表者 or 所属確定済み（役職不問）の組織を取得
  // 2026-07-25: 団体PRの掲載を役員限定→所属メンバー全員に緩和（RLSも同時変更）
  const [{ data: ownedOrgs }, { data: memberOrgs }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, type')
      .eq('representative_id', user.id),
    supabase
      .from('memberships')
      .select('org_id, organizations(id, name, type)')
      .eq('member_id', user.id)
      .eq('status', 'confirmed')
      .is('left_at', null),
  ])

  const orgMap = new Map<string, EditableOrg>()
  ;(ownedOrgs ?? []).forEach((o) => orgMap.set(o.id, o as EditableOrg))
  ;(memberOrgs ?? []).forEach((m) => {
    const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations
    if (o) orgMap.set(o.id, o as EditableOrg)
  })
  const myOrgs = Array.from(orgMap.values())

  // 2026-09-15: 運営者（committee / super）は、団体の依頼を受けて代理で掲載できる。
  // 所属団体に加えて全団体を選べるようにする（実際に掲載できるかはサーバー側で再判定する）
  const { data: me } = await supabase.from('members').select('admin_role').eq('id', user.id).maybeSingle()
  const isOperator = me?.admin_role === 'committee' || me?.admin_role === 'super'
  let editableOrgs = myOrgs
  if (isOperator) {
    const { data: allOrgs } = await supabase.from('organizations').select('id, name, type').order('name')
    const own = new Set(myOrgs.map((o) => o.id))
    editableOrgs = [...myOrgs, ...((allOrgs ?? []) as EditableOrg[]).filter((o) => !own.has(o.id))]
  }

  async function handleCreate(formData: FormData): Promise<{ error: string } | void> {
    'use server'
    const poster_kind = String(formData.get('poster_kind') ?? 'member') as FreefreePosterKind
    const org_id = formData.get('org_id') ? String(formData.get('org_id')) : undefined
    const images = (formData.getAll('images') as string[]).filter((u) => u.length > 0).slice(0, 3)
    const couponContent = String(formData.get('coupon_content') ?? '').trim()
    const usageLimitRaw = formData.get('coupon_usage_limit')
    const coupon = couponContent
      ? {
          content: couponContent,
          conditions: String(formData.get('coupon_conditions') ?? '').trim() || undefined,
          usage_limit: usageLimitRaw ? Number(usageLimitRaw) : undefined,
        }
      : undefined
    // 失敗したときは例外を投げずにエラー文を返す。投げると画面ごと作り直され、入力が全部消えるため
    return createFreefreePost({
      poster_kind,
      org_id,
      sns_share: formData.get('sns_share') === 'on',
      sns_display_name: String(formData.get('sns_display_name') ?? '').trim() || undefined,
      links: (formData.getAll('links') as string[])
        .map((s) => {
          try {
            const o = JSON.parse(s) as { label?: unknown; url?: unknown }
            const label = String(o.label ?? '').trim().slice(0, 30)
            const url = String(o.url ?? '').trim()
            return label && /^https?:\/\//i.test(url) ? { label, url } : null
          } catch {
            return null
          }
        })
        .filter((l): l is { label: string; url: string } => l !== null)
        .slice(0, 5),
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      category: String(formData.get('category') ?? 'event'),
      location: (formData.get('location') as string | null) || undefined,
      // 🗺 メタバース印西のお店ピン
      metaverse_pin: formData.get('metaverse_pin') === 'on',
      address: String(formData.get('address') ?? '').trim() || undefined,
      shop_links: ([
        ['ホームページ', 'link_hp'],
        ['オンラインショップ', 'link_shop'],
        ['SNS', 'link_sns'],
      ] as [string, string][])
        .map(([label, name]) => {
          const url = String(formData.get(name) ?? '').trim()
          return /^https?:\/\//i.test(url) ? { label, url } : null
        })
        .filter((l): l is { label: string; url: string } => l !== null),
      end_date: String(formData.get('end_date') ?? ''),
      event_start_date: String(formData.get('event_start_date') ?? '') || undefined,
      images,
      coupon,
    }).catch((e: unknown) => {
      // 掲載後に詳細ページへ移る処理（redirect）も例外として届くので、それはそのまま投げ直す
      unstable_rethrow(e)
      console.error('[freefree/new] 掲載に失敗:', e)
      return { error: e instanceof Error ? e.message : String(e) }
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/freefree" className="hover:underline">← FreeFree</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しい掲載</h1>
        <NewFreefreeForm
          action={handleCreate}
          userId={user.id}
          editableOrgs={editableOrgs}
          memberOrgIds={myOrgs.map((o) => o.id)}
          isOperator={isOperator}
          posterKinds={FREEFREE_POSTER_KINDS.map(({ key, label, needsOrg }) => ({ key, label, needsOrg }))}
          categories={FREEFREE_CATEGORIES.map(({ key, label }) => ({ key, label }))}
        />
      </div>
    </div>
  )
}
