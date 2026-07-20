'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { canUserEditOrg } from '@/lib/org-permissions'

type OrgInput = {
  name: string
  type: 'civic_group' | 'business' | 'government'  // 印西市市民活動推進条例 第2条準拠
  legal_form?: string
  description?: string
  inzai_registration_number?: string
  contact_email?: string
  contact_url?: string
  categories: string[]
  // 作成者が自分を代表者として申告するかどうか。
  // true: representative_id=user, membership role='representative'
  // false: representative_id=null, membership role='member'（情報を入れた人 / 会員扱い）
  as_representative: boolean
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

  // admin が登録する場合は即公開。一般ユーザーは申告として承認待ち。
  const isAdmin = !!member.admin_role
  const asRep = !!input.as_representative
  const nowIso = new Date().toISOString()

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name: input.name,
      type: input.type,
      legal_form: input.legal_form || null,
      description: input.description ?? null,
      inzai_registration_number: input.inzai_registration_number || null,
      contact_email: input.contact_email || null,
      contact_url: input.contact_url || null,
      public_flag: isAdmin,
      // 代表者として申告した場合のみ自分を representative_id にセット。
      // そうでない場合は NULL（後から admin/me/edit で代表者が確定）。
      representative_id: asRep ? user.id : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`団体作成失敗: ${error.message}`)

  await supabase.from('memberships').insert({
    org_id: org.id,
    member_id: user.id,
    role: asRep ? 'representative' : 'member',
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

/**
 * 「人材バンクとしてこの団体で活動したい」というソフトな意思表示。
 * memberships は作らない（正式加入は別 flow）。
 * - org_interests に1行 INSERT
 * - 団体に contact_email があれば Resend で通知
 * - 本人にも控えメール
 * メール送信は best-effort（失敗してもDB は INSERT 済みなのでユーザーには成功扱い、err は email_error 列に保存）。
 */
export async function expressInterest(orgId: string, message: string, contactOk: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const trimmed = message.trim()
  if (trimmed.length < 1 || trimmed.length > 400) {
    throw new Error('メッセージは 1〜400 字で入力してください')
  }

  const { data: member } = await supabase
    .from('members')
    .select('display_name, tier')
    .eq('id', user.id)
    .single()
  if (!member) throw new Error('メンバー情報が見つかりません')
  if (member.tier === 'light') {
    throw new Error('本登録（プロフィール完成）後に応募できます')
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, contact_email')
    .eq('id', orgId)
    .single()
  if (!org) throw new Error('団体が見つかりません')

  const { data: inserted, error: insertErr } = await supabase
    .from('org_interests')
    .insert({
      org_id: orgId,
      member_id: user.id,
      message: trimmed,
      contact_ok: contactOk,
    })
    .select('id')
    .single()
  if (insertErr) throw new Error(`応募の保存に失敗: ${insertErr.message}`)

  let emailSentAt: string | null = null
  let emailError: string | null = null

  if (org.contact_email && contactOk) {
    try {
      const apiKey = process.env.RESEND_API_KEY
      const from = process.env.MAIL_FROM
      if (apiKey && from) {
        const { Resend } = await import('resend')
        const resend = new Resend(apiKey)
        const senderEmail = user.email ?? '(連絡先非公開)'
        const orgUrl = `https://cidao.vercel.app/orgs/${orgId}`
        const orgInterestsUrl = `https://cidao.vercel.app/orgs/${orgId}#interests`

        const { error: sendErr } = await resend.emails.send({
          from,
          to: org.contact_email,
          subject: `【CiDAO 登録メンバー】${member.display_name} さんから「活動に参加したい」との申し出があります`,
          text: [
            `${org.name} ご担当者様`,
            ``,
            `CiDAO（市民DAO）の登録メンバーから、貴団体への参加意思が届きました。`,
            ``,
            `─────────────────────────────`,
            `差出人: ${member.display_name}`,
            `連絡先: ${senderEmail}`,
            `─────────────────────────────`,
            `メッセージ：`,
            ``,
            trimmed,
            ``,
            `─────────────────────────────`,
            ``,
            `団体ページ（CiDAO）: ${orgUrl}`,
            `応募一覧（要ログイン）: ${orgInterestsUrl}`,
            ``,
            `※ このメールは CiDAO の登録メンバー機能による自動通知です。`,
            `※ 受信を停止したい場合は CiDAO サイトの団体編集画面で contact_email を変更してください。`,
            ``,
            `Community Bank INZAI (CBI) / CiDAO`,
          ].join('\n'),
          replyTo: senderEmail !== '(連絡先非公開)' ? senderEmail : undefined,
        })
        if (sendErr) {
          emailError = sendErr.message ?? 'resend send failed'
        } else {
          emailSentAt = new Date().toISOString()
        }
      } else {
        emailError = 'RESEND_API_KEY or MAIL_FROM not configured'
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e)
    }
  } else if (!org.contact_email) {
    emailError = 'org has no contact_email'
  }

  // 送信結果を行に書き戻す（best-effort）
  if (inserted) {
    await supabase
      .from('org_interests')
      .update({ email_sent_at: emailSentAt, email_error: emailError })
      .eq('id', inserted.id)
  }

  revalidatePath(`/orgs/${orgId}`)
  return {
    ok: true,
    emailSent: !!emailSentAt,
    emailError,
    hasOrgEmail: !!org.contact_email,
  }
}

export async function leaveOrg(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // 団体の代表者は脱退不可（organizations.representative_id の FK が残るため、先に代表変更が必要）
  const { data: org } = await supabase
    .from('organizations')
    .select('representative_id, name')
    .eq('id', orgId)
    .single()
  if (org?.representative_id === user.id) {
    throw new Error('団体の代表者は脱退できません。先に管理者へ代表者の変更を依頼してください')
  }

  const { error } = await supabase
    .from('memberships')
    .update({ left_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('member_id', user.id)
    .is('left_at', null)
  if (error) throw new Error(`脱退に失敗: ${error.message}`)

  revalidatePath('/me/edit')
  revalidatePath('/me')
  revalidatePath(`/orgs/${orgId}`)
}

export async function requestJoinOrg(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // (org_id, member_id) は memberships の主キー。再申請で duplicate 500 にならないよう
  // 既存行を必ず先に見て、状態別に処理する。
  const { data: existing } = await supabase
    .from('memberships')
    .select('status, role, left_at')
    .eq('org_id', orgId)
    .eq('member_id', user.id)
    .maybeSingle()

  if (existing && existing.left_at === null) {
    // 既に active（申請中 or 承認済み）→ 何もしない冪等
    revalidatePath(`/orgs/${orgId}`)
    return { alreadyExists: true, status: existing.status, role: existing.role }
  }

  if (existing && existing.left_at !== null) {
    // 過去に脱退済 → 「再加入」として更新（status='claimed' で承認待ちに戻す）
    const { error } = await supabase
      .from('memberships')
      .update({
        status: 'claimed',
        role: 'member',
        left_at: null,
        approved_at: null,
        approved_by: null,
      })
      .eq('org_id', orgId)
      .eq('member_id', user.id)
    if (error) throw new Error(`再加入申請失敗: ${error.message}`)
    revalidatePath(`/orgs/${orgId}`)
    return { alreadyExists: false, status: 'claimed' as const, role: 'member' as const }
  }

  const { error } = await supabase.from('memberships').insert({
    org_id: orgId,
    member_id: user.id,
    role: 'member',
    status: 'claimed',
  })
  if (error) throw new Error(`参加申請失敗: ${error.message}`)
  revalidatePath(`/orgs/${orgId}`)
  return { alreadyExists: false, status: 'claimed' as const, role: 'member' as const }
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

// 自動拡充された情報を「正しい」と確認するアクション（編集権者のみ）。
// 内容変更なしで info_verified を立てる軽量経路。本格的に直したい人は /orgs/[id]/edit を使う。
export async function verifyOrgInfo(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, representative_id, contact_email, name')
    .eq('id', orgId)
    .single()
  if (!org) throw new Error('団体が見つかりません')

  const allowed = await canUserEditOrg(supabase, org, user.id, user.email ?? null)
  if (!allowed) throw new Error('この団体の情報を確認する権限がありません')

  const { error } = await supabase
    .from('organizations')
    .update({ info_verified: true })
    .eq('id', orgId)
  if (error) throw new Error(`確認失敗: ${error.message}`)

  revalidatePath(`/orgs/${orgId}`)
}

// 団体情報の編集（編集権者のみ）。任意フィールドだけ送れば良い。
// 編集が行われた＝代表者が内容を承認したものとして info_verified=true にする。
export type OrgEditInput = {
  description?: string | null
  website_url?: string | null
  sns_links?: Record<string, string> | null
  activity_detail?: string | null
  activity_area?: string | null
  contact_email?: string | null
  contact_url?: string | null
  legal_form?: string | null
  inzai_registration_number?: string | null
  logo_url?: string | null
}

export async function updateOrgInfo(orgId: string, input: OrgEditInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, representative_id, contact_email, name')
    .eq('id', orgId)
    .single()
  if (!org) throw new Error('団体が見つかりません')

  const allowed = await canUserEditOrg(supabase, org, user.id, user.email ?? null)
  if (!allowed) throw new Error('この団体を編集する権限がありません')

  // クリーンアップ：空文字は NULL に
  const clean = (v: string | null | undefined) => {
    if (v == null) return null
    const t = v.trim()
    return t === '' ? null : t
  }

  const updates: Record<string, unknown> = { info_verified: true }
  if (input.description !== undefined) updates.description = clean(input.description)
  if (input.website_url !== undefined) updates.website_url = clean(input.website_url)
  if (input.activity_detail !== undefined) updates.activity_detail = clean(input.activity_detail)
  if (input.activity_area !== undefined) updates.activity_area = clean(input.activity_area)
  if (input.contact_email !== undefined) updates.contact_email = clean(input.contact_email)
  if (input.contact_url !== undefined) updates.contact_url = clean(input.contact_url)
  if (input.legal_form !== undefined) updates.legal_form = clean(input.legal_form)
  if (input.inzai_registration_number !== undefined) updates.inzai_registration_number = clean(input.inzai_registration_number)
  if (input.logo_url !== undefined) updates.logo_url = clean(input.logo_url)
  if (input.sns_links !== undefined) {
    if (!input.sns_links) {
      updates.sns_links = {}
    } else {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(input.sns_links)) {
        const c = clean(v)
        if (c) out[k] = c
      }
      updates.sns_links = out
    }
  }

  const { error } = await supabase.from('organizations').update(updates).eq('id', orgId)
  if (error) throw new Error(`更新失敗: ${error.message}`)

  revalidatePath(`/orgs/${orgId}`)
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

// ===========================
// QR 受付（reception）
// ===========================

// service_role クライアント（checkins への書込・members 検索用。RLS を通さない分、
// 呼び出し前に必ず assertReceptionOperator で操作者の権限を検証する）
function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('サーバー設定エラー（service role 未設定）')
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// 受付操作者の権限チェック：当該団体の confirmed メンバー、または CiDAO 管理者
async function assertReceptionOperator(orgId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (isAdmin) return user.id

  const { data: mem } = await supabase
    .from('memberships')
    .select('status')
    .eq('org_id', orgId)
    .eq('member_id', user.id)
    .eq('status', 'confirmed')
    .is('left_at', null)
    .maybeSingle()
  if (!mem) throw new Error('この団体の受付を操作する権限がありません（承認済みメンバーのみ）')
  return user.id
}

export type ReceptionResult = {
  ok: boolean
  alreadyCheckedIn?: boolean
  memberName?: string
  error?: string
}

// QR/手動受付の本体。eventId 指定時は event_participants の出欠も付ける（ptはDBトリガーが付与）
export async function receptionCheckin(
  orgId: string,
  memberId: string,
  opts: { eventId?: string | null; purpose?: string | null },
): Promise<ReceptionResult> {
  try {
    const operatorId = await assertReceptionOperator(orgId)
    const eventId = opts.eventId?.trim() || null
    const purpose = opts.purpose?.trim().slice(0, 60) || null
    if (!eventId && !purpose) return { ok: false, error: '受付名かイベントを指定してください' }

    const admin = createAdminClient()

    // 対象メンバーの存在確認（実名があれば受付表示に使う）
    const { data: target } = await admin
      .from('members')
      .select('id, display_name, member_private(real_name)')
      .eq('id', memberId)
      .maybeSingle()
    if (!target) return { ok: false, error: 'この QR は CiDAO の会員証ではないようです' }
    const priv = (Array.isArray(target.member_private) ? target.member_private[0] : target.member_private) as { real_name: string | null } | null
    const receptionName = priv?.real_name ? `${priv.real_name}（${target.display_name}）` : target.display_name

    // イベント指定時：当該団体のイベントであることを確認
    if (eventId) {
      const { data: ev } = await admin
        .from('events')
        .select('id, organizer_type, organizer_id')
        .eq('id', eventId)
        .maybeSingle()
      if (!ev || ev.organizer_type !== 'org' || ev.organizer_id !== orgId) {
        return { ok: false, error: 'この団体のイベントではありません' }
      }
    }

    // 当日の同一受付（同じイベント or 同じ受付名）の重複チェック
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    let dupQuery = admin
      .from('checkins')
      .select('id')
      .eq('org_id', orgId)
      .eq('member_id', memberId)
      .gte('created_at', todayStart.toISOString())
    dupQuery = eventId ? dupQuery.eq('event_id', eventId) : dupQuery.eq('purpose', purpose)
    const { data: dup } = await dupQuery.limit(1).maybeSingle()
    if (dup) return { ok: true, alreadyCheckedIn: true, memberName: receptionName }

    const { error: insErr } = await admin.from('checkins').insert({
      org_id: orgId,
      member_id: memberId,
      event_id: eventId,
      purpose,
      scanned_by: operatorId,
    })
    if (insErr) return { ok: false, error: `受付記録に失敗: ${insErr.message}` }

    // イベント連動：出席を付ける（既存参加者は role 維持、未登録なら participant で追加）
    if (eventId) {
      const { data: existing } = await admin
        .from('event_participants')
        .select('role')
        .eq('event_id', eventId)
        .eq('member_id', memberId)
        .maybeSingle()
      if (existing) {
        await admin
          .from('event_participants')
          .update({ attended: true })
          .eq('event_id', eventId)
          .eq('member_id', memberId)
      } else {
        await admin.from('event_participants').insert({
          event_id: eventId,
          member_id: memberId,
          role: 'participant',
          attended: true,
        })
      }
      revalidatePath(`/events/${eventId}`)
    }

    return { ok: true, memberName: receptionName }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 手動受付用のメンバー検索（表示名・実名の部分一致、最大8件）
// 実名は非公開情報だが、受付用途に限り受付担当者（承認済みメンバー）へ表示する。
export async function searchMembersForReception(
  orgId: string,
  query: string,
): Promise<Array<{ id: string; display_name: string; real_name: string | null; avatar_url: string | null }>> {
  await assertReceptionOperator(orgId)
  const q = query.trim()
  if (q.length < 1) return []
  const pattern = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`

  const admin = createAdminClient()

  // (1) 表示名でヒット
  const { data: byDisplay } = await admin
    .from('members')
    .select('id, display_name, avatar_url, member_private(real_name)')
    .ilike('display_name', pattern)
    .is('deleted_at', null)
    .limit(8)

  // (2) 実名でヒット。姓名間の半角/全角スペース有無の表記ゆれを吸収するため、
  //     クエリ側の空白も除去し、DB側の空白除去済み生成列（real_name_normalized）と比較する
  const normalizedQuery = q.replace(/[\s　]+/g, '')
  const normalizedPattern = `%${normalizedQuery.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const { data: byReal } = await admin
    .from('member_private')
    .select('member_id, real_name, members!inner(id, display_name, avatar_url, deleted_at)')
    .not('real_name', 'is', null)
    .ilike('real_name_normalized', normalizedPattern)
    .limit(8)

  type Row = { id: string; display_name: string; real_name: string | null; avatar_url: string | null }
  const map = new Map<string, Row>()
  for (const m of byDisplay ?? []) {
    const priv = (Array.isArray(m.member_private) ? m.member_private[0] : m.member_private) as { real_name: string | null } | null
    map.set(m.id, { id: m.id, display_name: m.display_name, real_name: priv?.real_name ?? null, avatar_url: m.avatar_url })
  }
  for (const p of byReal ?? []) {
    const mem = (Array.isArray(p.members) ? p.members[0] : p.members) as { id: string; display_name: string; avatar_url: string | null; deleted_at: string | null } | null
    if (!mem || mem.deleted_at) continue
    if (!map.has(mem.id)) {
      map.set(mem.id, { id: mem.id, display_name: mem.display_name, real_name: p.real_name, avatar_url: mem.avatar_url })
    }
  }
  return [...map.values()].slice(0, 8)
}
