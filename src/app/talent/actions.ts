'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

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

  // 相手のメール (auth.users.email) を service_role で取得
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
      const { data: targetAuth, error: getUserErr } = await admin.auth.admin.getUserById(targetMemberId)
      const targetEmail = targetAuth?.user?.email
      if (getUserErr || !targetEmail) {
        emailError = 'target email lookup failed'
      } else {
        const { Resend } = await import('resend')
        const resend = new Resend(apiKey)
        const senderEmail = user.email ?? '(連絡先非公開)'
        const profileUrl = `https://cidao.vercel.app/talent/${targetMemberId}`

        const { error: sendErr } = await resend.emails.send({
          from,
          to: targetEmail,
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
