import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FREEFREE_CATEGORIES, FREEFREE_PERIODS, FREEFREE_POSTER_KINDS, type FreefreePosterKind } from '@/lib/freefree-categories'
import { createFreefreePost } from '../actions'
import NewFreefreeForm from './_components/NewFreefreeForm'

type EditableOrg = { id: string; name: string; type: 'civic_group' | 'business' | 'government' }

export default async function NewFreefreePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/freefree/new')

  // 自分が代表者 or membership で representative/officer の組織を取得
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
      .in('role', ['representative', 'officer'])
      .is('left_at', null),
  ])

  const orgMap = new Map<string, EditableOrg>()
  ;(ownedOrgs ?? []).forEach((o) => orgMap.set(o.id, o as EditableOrg))
  ;(memberOrgs ?? []).forEach((m) => {
    const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations
    if (o) orgMap.set(o.id, o as EditableOrg)
  })
  const editableOrgs = Array.from(orgMap.values())

  async function handleCreate(formData: FormData) {
    'use server'
    const poster_kind = String(formData.get('poster_kind') ?? 'member') as FreefreePosterKind
    const org_id = formData.get('org_id') ? String(formData.get('org_id')) : undefined
    await createFreefreePost({
      poster_kind,
      org_id,
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      category: String(formData.get('category') ?? 'event'),
      location: (formData.get('location') as string | null) || undefined,
      period: String(formData.get('period') ?? 'p_1month') as 'p_1week' | 'p_1month' | 'p_3months',
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/freefree" className="hover:underline">← FreeFree</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しい掲載</h1>
        <NewFreefreeForm
          action={handleCreate}
          editableOrgs={editableOrgs}
          posterKinds={FREEFREE_POSTER_KINDS.map(({ key, label, needsOrg }) => ({ key, label, needsOrg }))}
          categories={FREEFREE_CATEGORIES.map(({ key, label }) => ({ key, label }))}
          periods={FREEFREE_PERIODS.map(({ key, label }) => ({ key, label }))}
        />
      </div>
    </div>
  )
}
