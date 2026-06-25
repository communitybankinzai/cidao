'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type OrgInput = {
  name: string
  type: 'voluntary' | 'civic' | 'company' | 'government'
  description?: string
  inzai_registration_number?: string
  contact_email?: string
  contact_url?: string
  categories: string[]
}

export async function createOrganization(input: OrgInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      inzai_registration_number: input.inzai_registration_number || null,
      contact_email: input.contact_email || null,
      contact_url: input.contact_url || null,
      representative_id: user.id,
    })
    .select('id')
    .single()
  if (error) throw new Error(`団体作成失敗: ${error.message}`)

  // 自分を representative として membership 登録
  await supabase.from('memberships').insert({
    org_id: org.id,
    member_id: user.id,
    role: 'representative',
    status: 'confirmed',
    approved_at: new Date().toISOString(),
    approved_by: user.id,
    display_in_org: true,
  })

  // カテゴリ追加
  if (input.categories.length > 0) {
    await supabase.from('organization_categories').insert(
      input.categories.map((c, i) => ({ org_id: org.id, category: c, is_primary: i === 0 }))
    )
  }

  revalidatePath('/orgs')
  redirect(`/orgs/${org.id}`)
}

export async function requestJoinOrg(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase.from('memberships').insert({
    org_id: orgId,
    member_id: user.id,
    role: 'member',
    status: 'claimed',
  })
  if (error) throw new Error(`参加申請失敗: ${error.message}`)
  revalidatePath(`/orgs/${orgId}`)
}

export async function approveMembership(orgId: string, memberId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'confirmed', approved_at: new Date().toISOString(), approved_by: user.id })
    .eq('org_id', orgId)
    .eq('member_id', memberId)
  if (error) throw new Error(`承認失敗: ${error.message}`)
  revalidatePath(`/orgs/${orgId}`)
}
