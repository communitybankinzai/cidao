'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canUserEditOrg } from '@/lib/org-permissions'
import { periodToDays, freefreeCategoryLabel, type FreefreePosterKind } from '@/lib/freefree-categories'
import { notifyAllMembers } from '@/lib/notify'
import { recordWrite } from '@/lib/audit'

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
  sns_share?: boolean               // CBI公式SNSでの紹介を許可（既定true）
  sns_display_name?: string         // SNSで名指しに使う表示名（本人が出すと決めたときだけ）
  links?: { label: string; url: string }[]  // 参考リンク最大5件（元の告知ページ・申込フォーム等）
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
    // 2026-07-25: 掲載権限を役員限定→所属確定済みメンバー全員に緩和（RLSも同時変更済み）
    const canEdit = await canUserEditOrg(supabase, org, user.id, user.email ?? null)
    if (!canEdit) {
      const { data: membership } = await supabase
        .from('memberships')
        .select('org_id')
        .eq('org_id', org.id)
        .eq('member_id', user.id)
        .eq('status', 'confirmed')
        .is('left_at', null)
        .maybeSingle()
      if (!membership) throw new Error('この団体の所属メンバーではないため掲載できません')
    }
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
      sns_share: input.sns_share !== false,
      // 団体掲載では organizations.name を使うため保存しない
      sns_display_name:
        dbPosterType === 'org' ? null : (input.sns_display_name?.trim().slice(0, 40) || null),
      links: (input.links ?? [])
        .filter((l) => l && l.label && /^https?:\/\//i.test(l.url))
        .slice(0, 5)
        .map((l) => ({ label: l.label.slice(0, 30), url: l.url })),
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

  // 全メンバーへ新着通知（ベル＋Webプッシュ）。
  // after() でレスポンス後に回すので、掲載者を待たせない。失敗しても掲載は成立する。
  after(async () => {
    await notifyAllMembers({
      kind: 'freefree',
      actorId: user.id,
      prefKey: 'notify_freefree',
      title: `FreeFree掲示板に新しい掲載「${input.title}」`,
      body: [freefreeCategoryLabel(input.category), input.location?.trim()]
        .filter(Boolean)
        .join(' / ') || undefined,
      linkUrl: `/freefree/${data.id}`,
    })
  })

  // redirect() は例外を投げるので、記録はその前に済ませる
  await recordWrite({
    actorId: user.id,
    action: 'freefree.create',
    targetType: 'freefree',
    targetId: data.id,
    detail: { title: input.title, poster_type: dbPosterType },
  })

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
  await recordWrite({ actorId: user.id, action: 'freefree.like', targetType: 'freefree', targetId: postId })
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
  await recordWrite({
    actorId: user.id,
    action: 'freefree.comment',
    targetType: 'freefree',
    targetId: postId,
    detail: { body: body.trim().slice(0, 200) },
  })
  revalidatePath(`/freefree/${postId}`)
}
