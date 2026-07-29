'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { insertNotification } from '@/lib/notify'

/**
 * 相手メンバーのメール (auth.users.email) を service_role で解決し、
 * Resend で送信する。best-effort：呼び出し元は結果を行に書き戻すだけで、
 * 失敗しても本体処理（INSERT）は成立している。
 */
async function sendInquiryEmail(input: {
  toMemberId: string
  subject: string
  text: string
  replyTo?: string
}): Promise<{ emailSentAt: string | null; emailError: string | null }> {
  let emailSentAt: string | null = null
  let emailError: string | null = null

  try {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''

    if (!supaUrl || !serviceKey) {
      emailError = 'service role not configured'
    } else if (!apiKey || !from) {
      emailError = 'RESEND_API_KEY or MAIL_FROM not configured'
    } else {
      const admin = createSupabaseClient(supaUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: targetAuth, error: getUserErr } = await admin.auth.admin.getUserById(input.toMemberId)
      const targetEmail = targetAuth?.user?.email
      if (getUserErr || !targetEmail) {
        emailError = 'target email lookup failed'
      } else {
        const { Resend } = await import('resend')
        const resend = new Resend(apiKey)
        const { error: sendErr } = await resend.emails.send({
          from,
          to: targetEmail,
          subject: input.subject,
          text: input.text,
          replyTo: input.replyTo,
        })
        if (sendErr) {
          emailError = sendErr.message ?? 'resend send failed'
        } else {
          emailSentAt = new Date().toISOString()
        }
      }
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e)
  }

  return { emailSentAt, emailError }
}

/**
 * 人材バンクのメンバーにメッセージを送る（コンタクト動線）。
 *
 * - talent_inquiries に1行 INSERT（RLS: 本登録以上の本人のみ、相手が message_acceptance != 'closed' のとき）
 * - 相手のメール（auth.users.email、service_role で取得）に Resend で通知
 * - reply-to に送信者本人のメールを入れて、相手は受信メールに直接返信できる
 * - メール送信は best-effort、失敗は email_error に保存
 */
export async function sendTalentInquiry(targetMemberId: string, message: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const trimmed = message.trim()
  if (trimmed.length < 1 || trimmed.length > 600) {
    throw new Error('メッセージは 1〜600 字で入力してください')
  }
  if (targetMemberId === user.id) {
    throw new Error('自分自身には送信できません')
  }

  const { data: senderMember } = await supabase
    .from('members')
    .select('display_name, tier')
    .eq('id', user.id)
    .single()
  if (!senderMember) throw new Error('メンバー情報が見つかりません')
  if (senderMember.tier === 'light') {
    throw new Error('本登録（プロフィール完成）後にコンタクトできます')
  }

  // ターゲットの公開状態チェック
  const { data: targetPr } = await supabase
    .from('member_profiles_pr')
    .select('message_acceptance')
    .eq('member_id', targetMemberId)
    .maybeSingle()
  if (!targetPr || targetPr.message_acceptance === 'closed') {
    throw new Error('このメンバーは現在メッセージを受け付けていません')
  }

  const { data: targetMember } = await supabase
    .from('members')
    .select('display_name')
    .eq('id', targetMemberId)
    .single()
  if (!targetMember) throw new Error('相手のメンバー情報が見つかりません')

  // INSERT
  const { data: inserted, error: insertErr } = await supabase
    .from('talent_inquiries')
    .insert({
      to_member_id: targetMemberId,
      from_member_id: user.id,
      message: trimmed,
    })
    .select('id')
    .single()
  if (insertErr) throw new Error(`コンタクトの保存に失敗: ${insertErr.message}`)

  // アプリ内通知（best-effort）。LINEログインユーザーはメールを持たず
  // メール通知が届かないため、ベル通知＋受信箱が実質的な受信手段になる
  await insertNotification({
    recipientId: targetMemberId,
    actorId: user.id,
    kind: 'comment',
    title: `${senderMember.display_name}さんから「活動の声がけ」が届きました`,
    body: `${trimmed.slice(0, 80)}${trimmed.length > 80 ? '…' : ''}`,
    linkUrl: '/me/inbox',
  })

  const senderEmail = user.email ?? '(連絡先非公開)'
  const profileUrl = `https://cidao.vercel.app/talent/${targetMemberId}`
  const { emailSentAt, emailError } = await sendInquiryEmail({
    toMemberId: targetMemberId,
    subject: `【CiDAO 登録メンバー】${senderMember.display_name} さんから「活動の声がけ」が届いています`,
    text: [
      `${targetMember.display_name} 様`,
      ``,
      `CiDAO の登録メンバーのプロフィールをご覧になった ${senderMember.display_name} さんから、活動への声がけが届いています。`,
      ``,
      `─────────────────────────────`,
      `差出人: ${senderMember.display_name}`,
      `連絡先: ${senderEmail}`,
      `─────────────────────────────`,
      `メッセージ：`,
      ``,
      trimmed,
      ``,
      `─────────────────────────────`,
      ``,
      `受信箱で確認・返信: https://cidao.vercel.app/me/inbox`,
      `あなたのプロフィール: ${profileUrl}`,
      ``,
      `※ このメールは CiDAO の登録メンバー機能による自動通知です。`,
      `※ 返信は、このメールに直接 Reply すると ${senderMember.display_name} さんに直接届きます。`,
      `※ メッセージを今後受け取りたくない場合は CiDAO の /me/pr で『メッセージ受付』を『受け付けない』に変更してください。`,
      ``,
      `Community Bank INZAI (CBI) / CiDAO`,
    ].join('\n'),
    replyTo: senderEmail !== '(連絡先非公開)' ? senderEmail : undefined,
  })

  // 送信結果を行に書き戻す（best-effort、UPDATE policy は sender 本人）
  if (inserted) {
    await supabase
      .from('talent_inquiries')
      .update({ email_sent_at: emailSentAt, email_error: emailError })
      .eq('id', inserted.id)
  }

  revalidatePath(`/talent/${targetMemberId}`)
  return {
    ok: true,
    emailSent: !!emailSentAt,
    emailError,
  }
}

/**
 * 提案に「大賛成（是非協力したい）」を投じた人から、その提案の提案者へメッセージを送る。
 *
 * - 人材バンクの「声がけ」と同じ talent_inquiries / 受信箱を流用し、proposal_id で文脈を持たせる
 * - RLS（talent_inquiries_insert_proposal_supporter）が「大賛成を投じているか」「宛先が
 *   その提案の提案者か」を検証するため、提案者が人材バンクに公開していなくても送れる
 * - 返信は人材バンクと同じ replyTalentInquiry でスレッドに続く
 */
export async function sendProposalSupportMessage(
  proposalId: string,
  message: string
): Promise<{ ok: true; emailSent: boolean } | { ok: false; error: string }> {
  // 本番ビルドでは例外の本文がクライアントに渡らないため、失敗理由は戻り値で返す
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '未ログインです' }

  const trimmed = message.trim()
  if (trimmed.length < 1 || trimmed.length > 600) {
    return { ok: false, error: 'メッセージは 1〜600 字で入力してください' }
  }

  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, title, proposer_id')
    .eq('id', proposalId)
    .single()
  if (!proposal) return { ok: false, error: '提案が見つかりません' }
  if (proposal.proposer_id === user.id) {
    return { ok: false, error: '自分の提案には送信できません' }
  }

  const [{ data: senderMember }, { data: targetMember }] = await Promise.all([
    supabase.from('members').select('display_name, tier').eq('id', user.id).single(),
    supabase.from('members').select('display_name').eq('id', proposal.proposer_id).single(),
  ])
  if (!senderMember) return { ok: false, error: 'メンバー情報が見つかりません' }
  if (senderMember.tier === 'light') {
    return { ok: false, error: '本登録（プロフィール完成）後にメッセージを送れます' }
  }
  if (!targetMember) return { ok: false, error: '提案者のメンバー情報が見つかりません' }

  const { data: inserted, error: insertErr } = await supabase
    .from('talent_inquiries')
    .insert({
      to_member_id: proposal.proposer_id,
      from_member_id: user.id,
      message: trimmed,
      proposal_id: proposal.id,
    })
    .select('id')
    .single()
  if (insertErr) {
    // RLS で弾かれる主因は「大賛成を投じていない／撤回済み」
    return {
      ok: false,
      error: `メッセージの送信に失敗しました（提案に「大賛成」で投票済みか確認してください）: ${insertErr.message}`,
    }
  }

  await insertNotification({
    recipientId: proposal.proposer_id,
    actorId: user.id,
    kind: 'comment',
    title: `${senderMember.display_name}さんから提案「${proposal.title}」についてメッセージが届きました`,
    body: `${trimmed.slice(0, 80)}${trimmed.length > 80 ? '…' : ''}`,
    linkUrl: '/me/inbox',
  })

  const senderEmail = user.email ?? '(連絡先非公開)'
  const { emailSentAt, emailError } = await sendInquiryEmail({
    toMemberId: proposal.proposer_id,
    subject: `【CiDAO】${senderMember.display_name} さんがあなたの提案に協力を申し出ています`,
    text: [
      `${targetMember.display_name} 様`,
      ``,
      `あなたの提案に「大賛成（是非協力したい）」を投じた ${senderMember.display_name} さんから、メッセージが届いています。`,
      ``,
      `─────────────────────────────`,
      `提案: ${proposal.title}`,
      `差出人: ${senderMember.display_name}`,
      `連絡先: ${senderEmail}`,
      `─────────────────────────────`,
      `メッセージ：`,
      ``,
      trimmed,
      ``,
      `─────────────────────────────`,
      ``,
      `受信箱で確認・返信: https://cidao.vercel.app/me/inbox`,
      `提案ページ: https://cidao.vercel.app/proposals/${proposal.id}`,
      ``,
      `※ このメールは CiDAO の提案・投票機能による自動通知です。`,
      `※ 返信は、このメールに直接 Reply すると ${senderMember.display_name} さんに直接届きます。`,
      ``,
      `Community Bank INZAI (CBI) / CiDAO`,
    ].join('\n'),
    replyTo: senderEmail !== '(連絡先非公開)' ? senderEmail : undefined,
  })

  if (inserted) {
    await supabase
      .from('talent_inquiries')
      .update({ email_sent_at: emailSentAt, email_error: emailError })
      .eq('id', inserted.id)
  }

  revalidatePath(`/proposals/${proposalId}`)
  return { ok: true, emailSent: !!emailSentAt }
}

/**
 * 提案者から、その提案に「大賛成」で名乗り出た支援者へメッセージを送る。
 * 支援者からの1通目を待たずに提案者側から声をかけられるようにするための経路で、
 * RLS（talent_inquiries_insert_proposer_outreach）が宛先の名乗り状態を検証する。
 */
export async function sendProposalOutreachMessage(
  proposalId: string,
  supporterId: string,
  message: string
): Promise<{ ok: true; emailSent: boolean } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '未ログインです' }

  const trimmed = message.trim()
  if (trimmed.length < 1 || trimmed.length > 600) {
    return { ok: false, error: 'メッセージは 1〜600 字で入力してください' }
  }
  if (supporterId === user.id) return { ok: false, error: '自分自身には送信できません' }

  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, title, proposer_id')
    .eq('id', proposalId)
    .single()
  if (!proposal) return { ok: false, error: '提案が見つかりません' }
  if (proposal.proposer_id !== user.id) {
    return { ok: false, error: 'この提案の提案者ではありません' }
  }

  const [{ data: me }, { data: target }] = await Promise.all([
    supabase.from('members').select('display_name').eq('id', user.id).single(),
    supabase.from('members').select('display_name').eq('id', supporterId).single(),
  ])
  if (!me || !target) return { ok: false, error: 'メンバー情報が見つかりません' }

  const { data: inserted, error: insertErr } = await supabase
    .from('talent_inquiries')
    .insert({
      to_member_id: supporterId,
      from_member_id: user.id,
      message: trimmed,
      proposal_id: proposal.id,
    })
    .select('id')
    .single()
  if (insertErr) {
    return { ok: false, error: `メッセージの送信に失敗しました: ${insertErr.message}` }
  }

  await insertNotification({
    recipientId: supporterId,
    actorId: user.id,
    kind: 'comment',
    title: `提案「${proposal.title}」の提案者 ${me.display_name}さんからメッセージが届きました`,
    body: `${trimmed.slice(0, 80)}${trimmed.length > 80 ? '…' : ''}`,
    linkUrl: '/me/inbox',
  })

  const senderEmail = user.email ?? '(連絡先非公開)'
  const { emailSentAt, emailError } = await sendInquiryEmail({
    toMemberId: supporterId,
    subject: `【CiDAO】提案「${proposal.title}」の提案者からメッセージが届いています`,
    text: [
      `${target.display_name} 様`,
      ``,
      `あなたが「大賛成（是非協力したい）」を投じた提案の提案者 ${me.display_name} さんから、メッセージが届いています。`,
      ``,
      `─────────────────────────────`,
      `提案: ${proposal.title}`,
      `差出人: ${me.display_name}`,
      `連絡先: ${senderEmail}`,
      `─────────────────────────────`,
      `メッセージ：`,
      ``,
      trimmed,
      ``,
      `─────────────────────────────`,
      ``,
      `受信箱で確認・返信: https://cidao.vercel.app/me/inbox`,
      `提案ページ: https://cidao.vercel.app/proposals/${proposal.id}`,
      ``,
      `※ このメールは CiDAO の提案・投票機能による自動通知です。`,
      `※ 返信は、このメールに直接 Reply すると ${me.display_name} さんに直接届きます。`,
      ``,
      `Community Bank INZAI (CBI) / CiDAO`,
    ].join('\n'),
    replyTo: senderEmail !== '(連絡先非公開)' ? senderEmail : undefined,
  })

  if (inserted) {
    await supabase
      .from('talent_inquiries')
      .update({ email_sent_at: emailSentAt, email_error: emailError })
      .eq('id', inserted.id)
  }

  revalidatePath(`/proposals/${proposalId}`)
  return { ok: true, emailSent: !!emailSentAt }
}

/**
 * 届いた声がけ（またはそのスレッド）に返信する。
 *
 * - reply_to_inquiry_id にはスレッドのルート声がけ ID を渡す
 * - RLS（talent_inquiries_insert_reply）：ルートの当事者のみ、同じ相手にのみ INSERT できる
 * - 人材バンク掲載チェックは課さない（受信者が掲載者でない相手に返信するため）
 * - ベル通知＋メール（best-effort）は新規声がけと同じ経路
 */
export async function replyTalentInquiry(rootInquiryId: string, message: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const trimmed = message.trim()
  if (trimmed.length < 1 || trimmed.length > 600) {
    throw new Error('メッセージは 1〜600 字で入力してください')
  }

  // ルート声がけ（RLS で自分が当事者の行のみ見える）
  const { data: root } = await supabase
    .from('talent_inquiries')
    .select('id, to_member_id, from_member_id, reply_to_inquiry_id')
    .eq('id', rootInquiryId)
    .maybeSingle()
  if (!root || root.reply_to_inquiry_id !== null) {
    throw new Error('返信先の声がけが見つかりません')
  }

  const otherMemberId = root.from_member_id === user.id ? root.to_member_id : root.from_member_id
  if (otherMemberId === user.id) throw new Error('自分自身には送信できません')

  const [{ data: me }, { data: other }] = await Promise.all([
    supabase.from('members').select('display_name').eq('id', user.id).single(),
    supabase.from('members').select('display_name').eq('id', otherMemberId).single(),
  ])
  if (!me || !other) throw new Error('メンバー情報が見つかりません')

  const { data: inserted, error: insertErr } = await supabase
    .from('talent_inquiries')
    .insert({
      to_member_id: otherMemberId,
      from_member_id: user.id,
      message: trimmed,
      reply_to_inquiry_id: root.id,
    })
    .select('id')
    .single()
  if (insertErr) throw new Error(`返信の保存に失敗: ${insertErr.message}`)

  await insertNotification({
    recipientId: otherMemberId,
    actorId: user.id,
    kind: 'comment',
    title: `${me.display_name}さんから「活動の声がけ」への返信が届きました`,
    body: `${trimmed.slice(0, 80)}${trimmed.length > 80 ? '…' : ''}`,
    linkUrl: '/me/inbox',
  })

  const senderEmail = user.email ?? '(連絡先非公開)'
  const { emailSentAt, emailError } = await sendInquiryEmail({
    toMemberId: otherMemberId,
    subject: `【CiDAO 登録メンバー】${me.display_name} さんから返信が届いています`,
    text: [
      `${other.display_name} 様`,
      ``,
      `CiDAO「活動の声がけ」に ${me.display_name} さんから返信が届いています。`,
      ``,
      `─────────────────────────────`,
      `差出人: ${me.display_name}`,
      `連絡先: ${senderEmail}`,
      `─────────────────────────────`,
      `メッセージ：`,
      ``,
      trimmed,
      ``,
      `─────────────────────────────`,
      ``,
      `受信箱で確認・返信: https://cidao.vercel.app/me/inbox`,
      ``,
      `※ このメールは CiDAO の登録メンバー機能による自動通知です。`,
      `※ 返信は、このメールに直接 Reply すると ${me.display_name} さんに直接届きます。`,
      ``,
      `Community Bank INZAI (CBI) / CiDAO`,
    ].join('\n'),
    replyTo: senderEmail !== '(連絡先非公開)' ? senderEmail : undefined,
  })

  if (inserted) {
    await supabase
      .from('talent_inquiries')
      .update({ email_sent_at: emailSentAt, email_error: emailError })
      .eq('id', inserted.id)
  }

  revalidatePath('/me/inbox')
  return {
    ok: true,
    emailSent: !!emailSentAt,
    emailError,
  }
}
