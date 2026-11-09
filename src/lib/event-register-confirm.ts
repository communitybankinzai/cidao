// イベントを登録した本人への「お知らせしました」の確認通知（ベル🔔＋Webプッシュ）。
//
// 新着イベントの一斉通知は「自分の操作は通知しない」ため、登録した本人には何も届かず、
// 通知が本当に出たのか確かめられなかった。そこで、一斉通知の結果（宛先人数・届いた端末数）を
// 本人にだけ1通返す。人数は notifyAllMembers の戻り値をそのまま使う（推測ではなく実際の結果）。
//
// - 通知に会員の名前は載せない（人数のみ）
// - 宛先が0人のときは、宛先がいないのか送信に失敗したのか区別できないので、そのまま書く
// - insertNotification は actorId と宛先が同じだと送らないので、actorId は渡さない
// - スマホを鳴らすかは本人が選べる（マイページ /me の設定。contact_preferences.register_confirm_push）。
//   未設定はこれまでどおり鳴らす。false にした人だけ、アプリ内のベル🔔にだけ届く

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { insertNotification } from '@/lib/notify'
import { wantsRegisterConfirmPush } from '@/lib/register-confirm-pref'

const TITLE_MAX = 40

/** 本人の設定を読む。読めないとき（設定・通信の失敗）は従来どおり鳴らす側に倒す＝確認が届かなくなる事故を避ける */
async function readPushPreference(memberId: string): Promise<boolean> {
  try {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!supaUrl || !serviceKey) return true
    const admin = createSupabaseClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await admin.from('members').select('contact_preferences').eq('id', memberId).maybeSingle()
    return wantsRegisterConfirmPush((data as { contact_preferences?: unknown } | null)?.contact_preferences)
  } catch {
    return true
  }
}

function clip(text: string): string {
  const t = text.trim()
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t
}

export function buildRegisterConfirm(input: {
  title: string
  recipients: number
  pushed: number
  /** 複数日程をまとめて登録したときの回数（1回だけなら省略） */
  occurrences?: number
}): { title: string; body: string } {
  const { recipients, pushed } = input
  const times = input.occurrences && input.occurrences > 1 ? `（全${input.occurrences}回）` : ''
  const title = `「${clip(input.title)}」${times}を登録しました`

  if (recipients <= 0) {
    return {
      title,
      body: 'お知らせは0人でした。宛先がいなかったか、送信に失敗した可能性があります（登録そのものは完了しています）',
    }
  }
  const phone =
    pushed > 0
      ? `スマホに通知が届いた端末は ${pushed}台`
      : 'スマホへの通知は0台（アプリ内のベル🔔のみ）'
  return { title, body: `${recipients}人にお知らせしました。${phone}` }
}

/** best-effort：失敗しても登録そのものは成立させる（呼び出し側は after() で回す）。送れたら true */
export async function sendRegisterConfirm(input: {
  memberId: string
  eventId: string
  title: string
  result: { recipients: number; pushed: number }
  occurrences?: number
}): Promise<boolean> {
  try {
    const notice = buildRegisterConfirm({
      title: input.title,
      recipients: input.result.recipients,
      pushed: input.result.pushed,
      occurrences: input.occurrences,
    })
    const r = await insertNotification({
      recipientId: input.memberId,
      kind: 'event',
      title: notice.title,
      body: notice.body,
      linkUrl: `/events/${input.eventId}`,
      push: await readPushPreference(input.memberId),
    })
    return r.inserted
  } catch {
    return false
  }
}
