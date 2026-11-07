'use server'

// 管理画面「メンバー一覧」から、会員1人ずつにお知らせを送る。ベル🔔＋Webプッシュで届く。
// 送信できるのは管理者のみ（is_admin RPC で判定）。送った内容は direct_notices に記録する。
//
// 連絡許可の扱い（規則は src/lib/direct-notice.ts）:
//   活動のお誘い・お知らせ → 会員が「CBIからの連絡を許可」している場合だけ
//   手続き・サポートの連絡 → 許可に関係なく送れる

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { insertNotification } from '@/lib/notify'
import {
  canSendDirectNotice,
  isDirectNoticePurpose,
  validateDirectNotice,
} from '@/lib/direct-notice'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  return { supabase, user }
}

export type SendDirectNoticeResult =
  | { ok: true; pushed: number; recorded: boolean }
  | { ok: false; error: string }

export async function sendDirectNotice(input: {
  memberId: string
  purpose: string
  title: string
  body?: string
  linkUrl?: string
}): Promise<SendDirectNoticeResult> {
  try {
    const { supabase, user } = await requireAdmin()

    if (!UUID_RE.test(input.memberId)) return { ok: false, error: '宛先の会員が正しくありません' }
    if (!isDirectNoticePurpose(input.purpose)) return { ok: false, error: '連絡の種類を選んでください' }
    const purpose = input.purpose

    const checked = validateDirectNotice({ title: input.title, body: input.body, linkUrl: input.linkUrl })
    if (!checked.ok) return { ok: false, error: checked.error }
    const { title, body, linkUrl } = checked.value

    // 宛先の確認。連絡許可の列は画面からの値を信用せず、サーバー側で読み直す
    const service = createServiceClient()
    if (!service) return { ok: false, error: 'サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）がありません' }
    const { data: member, error: memberErr } = await service
      .from('members')
      .select('id, display_name, contact_permission, deleted_at')
      .eq('id', input.memberId)
      .maybeSingle()
    if (memberErr) return { ok: false, error: '宛先の会員を確認できませんでした' }
    if (!member || member.deleted_at) return { ok: false, error: '宛先の会員が見つからないか、退会済みです' }

    const allowed = canSendDirectNotice({
      contactPermission: member.contact_permission as boolean | null,
      purpose,
    })
    if (!allowed.ok) return { ok: false, error: allowed.reason }

    // 自分宛ての試し送りもできるよう、自分宛てのときだけ送信者を空にして届ける
    // （insertNotification は「本人の操作は本人に通知しない」ため）
    const isSelf = member.id === user.id
    const sent = await insertNotification({
      recipientId: member.id as string,
      actorId: isSelf ? null : user.id,
      kind: 'system',
      title,
      body,
      linkUrl,
    })
    if (!sent.inserted) {
      return { ok: false, error: sent.error ?? '送信に失敗しました' }
    }

    // 記録。失敗しても送信は済んでいるので、成功として返し、記録できなかったことだけ知らせる
    const { error: logErr } = await supabase.from('direct_notices').insert({
      recipient_id: member.id,
      sent_by: user.id,
      purpose,
      title,
      body: body ?? null,
      link_url: linkUrl ?? null,
      notification_id: sent.notificationId ?? null,
    })
    if (logErr) console.error('[admin/members] direct_notices の記録に失敗', logErr.message)

    revalidatePath('/admin/members')
    revalidatePath('/admin/members/light')
    return { ok: true, pushed: sent.pushed, recorded: !logErr }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '送信に失敗しました' }
  }
}
