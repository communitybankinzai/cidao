'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canUserEditOrg } from '@/lib/org-permissions'
import { periodToDays, type FreefreePosterKind } from '@/lib/freefree-categories'

type CouponInput = {
  content: string
  conditions?: string
  usage_limit?: number              // null/undefined = 無制限
}

type CreateInput = {
  poster_kind: FreefreePosterKind   // UI論理区分（5択）
  org_id?: string                   // poster_kind が civic_group/business/government のとき必須
  title: string
  body: string
  category: string
  location?: string
  period: 'p_1week' | 'p_1month' | 'p_3months'
  images?: string[]                 // public URL 最大3つ（client がアップロード済み）
  coupon?: CouponInput              // 任意のクーポン同時作成
}

export async function createFreefreePost(input: CreateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // 論理区分→DB列にマッピング
  let dbPosterType: 'member' | 'org' | 'individual_business'
  let dbPosterId: string
  if (input.poster_kind === 'member') {
    dbPosterType = 'member'; dbPosterId = user.id
  } else if (input.poster_kind === 'individual_business') {
    dbPosterType = 'individual_business'; dbPosterId = user.id
  } else {
    // civic_group / business / government → org として掲載
    if (!input.org_id) throw new Error('組織を選択してください')
    const { data: org } = await supabase
      .from('organizations')
      .select('id, type, name, representative_id, contact_email')
      .eq('id', input.org_id)
      .single()
    if (!org) throw new Error('組織が見つかりません')
    if (org.type !== input.poster_kind) {
      throw new Error(`選択した組織の種別 (${org.type}) と掲載区分 (${input.poster_kind}) が一致しません`)
    }
    const canEdit = await canUserEditOrg(supabase, org, user.id, user.email ?? null)
    if (!canEdit) throw new Error('この組織の代表者または編集権者ではないため掲載できません')
    dbPosterType = 'org'; dbPosterId = org.id
  }

  const expires_at = new Date(Date.now() + periodToDays(input.period) * 86400_000).toISOString()
  const images = (input.images ?? []).filter((u) => typeof u === 'string' && u.length > 0).slice(0, 3)
  const { data, error } = await supabase
    .from('freefree_posts')
    .insert({
      poster_type: dbPosterType,
      poster_id: dbPosterId,
      title: input.title,
      body: input.body,
      category: input.category,
      location: input.location ?? null,
      period: input.period,
      status: 'active',
      expires_at,
      images: images.length > 0 ? images : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`掲載失敗: ${error.message}`)

  // 任意でクーポン同時作成（best-effort、失敗しても投稿は成立）
  if (input.coupon && input.coupon.content.trim()) {
    const couponExpires = new Date(Date.now() + periodToDays(input.period) * 86400_000).toISOString()
    await supabase.from('coupons').insert({
      post_id: data.id,
      content: input.coupon.content.trim(),
      conditions: input.coupon.conditions?.trim() || null,
      usage_limit: input.coupon.usage_limit ?? null,
      expires_at: couponExpires,
    })
  }

  revalidatePath('/freefree')
  redirect(`/freefree/${data.id}`)
}

export async function useCoupon(couponId: string, postId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { error } = await supabase
    .from('coupon_uses')
    .insert({ coupon_id: couponId, member_id: user.id })
  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      throw new Error('このクーポンは既に使用済みです')
    }
    throw new Error(`使用失敗: ${error.message}`)
  }
  revalidatePath(`/freefree/${postId}`)
}

export async function likeFreefree(postId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { error } = await supabase.from('supports').insert({
    post_id: postId, member_id: user.id, kind: 'like',
  })
  if (error && !error.message.includes('duplicate')) throw new Error(`応援失敗: ${error.message}`)
  revalidatePath(`/freefree/${postId}`)
}

export async function commentFreefree(postId: string, body: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  if (body.trim().length < 1) throw new Error('応援メッセージを入力してください')
  const { error } = await supabase.from('supports').insert({
    post_id: postId, member_id: user.id, kind: 'comment', body: body.trim(),
  })
  if (error) throw new Error(`コメント失敗: ${error.message}`)
  revalidatePath(`/freefree/${postId}`)
}
