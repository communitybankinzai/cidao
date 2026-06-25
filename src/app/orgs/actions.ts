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

  const { data: member } = await supabase
    .from('members')
    .select('tier, admin_role')
    .eq('id', user.id)
    .single()
  if (!member) throw new Error('メンバー情報が見つかりません')
  if (member.tier === 'light') {
    throw new Error('プロフィール完成（本登録）後に団体を申告できます')
  }

  // admin が登録する場合は即公開＋代表者確定。一般ユーザーは申告として承認待ち。
  const isAdmin = !!member.admin_role
  const nowIso = new Date().toISOString()

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      inzai_registration_number: input.inzai_registration_number || null,
      contact_email: input.contact_email || null,
      contact_url: input.contact_url || null,
      public_flag: isAdmin,
      // representative_id は申請者を必ず入れる（NOT NULL 制約）。
      // 一般ユーザーの場合は承認時に管理者が必要に応じて差し替え可能。
      representative_id: user.id,
    })
    .select('id')
    .single()
  if (error) throw new Error(`団体作成失敗: ${error.message}`)

  await supabase.from('memberships').insert({
    org_id: org.id,
    member_id: user.id,
    role: 'representative',
    status: isAdmin ? 'confirmed' : 'claimed',
    approved_at: isAdmin ? nowIso : null,
    approved_by: isAdmin ? user.id : null,
    display_in_org: true,
  })

  if (input.categories.length > 0) {
    await supabase.from('organization_categories').insert(
      input.categories.map((c, i) => ({ org_id: org.id, category: c, is_primary: i === 0 })),
    )
  }

  revalidatePath('/orgs')
  revalidatePath('/admin/claims')
  if (isAdmin) {
    redirect(`/orgs/${org.id}`)
  } else {
    redirect('/me?new_org=submitted')
  }
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

export type OrgClaim = { org_id: string; as_representative: boolean }

export async function claimMemberships(claims: OrgClaim[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  if (!Array.isArray(claims) || claims.length === 0) return { inserted: 0 }

  // 既存 membership がある org は除外（重複申告防止）
  const orgIds = claims.map((c) => c.org_id)
  const { data: existing } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('member_id', user.id)
    .in('org_id', orgIds)
    .is('left_at', null)

  const skip = new Set((existing ?? []).map((r) => r.org_id))
  const toInsert = claims
    .filter((c) => !skip.has(c.org_id))
    .map((c) => ({
      org_id: c.org_id,
      member_id: user.id,
      role: c.as_representative ? ('representative' as const) : ('member' as const),
      status: 'claimed' as const,
    }))

  if (toInsert.length === 0) return { inserted: 0, skipped: claims.length }

  const { error } = await supabase.from('memberships').insert(toInsert)
  if (error) throw new Error(`所属申告失敗: ${error.message}`)

  revalidatePath('/me')
  revalidatePath('/admin/claims')
  return { inserted: toInsert.length, skipped: claims.length - toInsert.length }
}

export async function approveClaim(orgId: string, memberId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('管理者権限が必要です')

  const { data: row } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('member_id', memberId)
    .single()

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'confirmed', approved_at: new Date().toISOString(), approved_by: user.id })
    .eq('org_id', orgId)
    .eq('member_id', memberId)
  if (error) throw new Error(`承認失敗: ${error.message}`)

  // 代表者承認時、その団体に既存代表者がいなければ representative_id を更新。
  // また public_flag=false の新規団体ならここで公開する。
  if (row?.role === 'representative') {
    const { data: org } = await supabase
      .from('organizations')
      .select('representative_id, public_flag')
      .eq('id', orgId)
      .single()
    if (org) {
      const updates: { representative_id?: string; public_flag?: boolean } = {}
      if (!org.representative_id) updates.representative_id = memberId
      if (!org.public_flag) updates.public_flag = true
      if (Object.keys(updates).length > 0) {
        await supabase.from('organizations').update(updates).eq('id', orgId)
      }
    }
  }

  revalidatePath('/admin/claims')
  revalidatePath('/orgs')
  revalidatePath(`/orgs/${orgId}`)
}

export async function rejectClaim(orgId: string, memberId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('管理者権限が必要です')

  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('org_id', orgId)
    .eq('member_id', memberId)
    .eq('status', 'claimed')
  if (error) throw new Error(`却下失敗: ${error.message}`)

  // 未公開（申告中）の新規団体で、承認済のメンバーが他に居なければ団体ごと削除
  const { data: org } = await supabase
    .from('organizations')
    .select('public_flag')
    .eq('id', orgId)
    .single()
  if (org && !org.public_flag) {
    const { data: confirmed } = await supabase
      .from('memberships')
      .select('member_id')
      .eq('org_id', orgId)
      .eq('status', 'confirmed')
      .limit(1)
    if (!confirmed || confirmed.length === 0) {
      await supabase.from('organization_categories').delete().eq('org_id', orgId)
      await supabase.from('memberships').delete().eq('org_id', orgId)
      await supabase.from('organizations').delete().eq('id', orgId)
    }
  }

  revalidatePath('/admin/claims')
  revalidatePath('/orgs')
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
