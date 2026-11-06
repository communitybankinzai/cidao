// 参加登録があったとき、主催者（role = organizer）へ知らせる（ベル🔔＋Webプッシュ）。
// 通知に会員の名前は載せない：プッシュは端末のロック画面にも出るため、人数だけ伝え、
// 誰が登録したかは主催者が詳細ページの名簿（主催者だけが見られる）で確かめる。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { insertNotification } from '@/lib/notify'

export function buildJoinNotice(input: {
  title: string
  participantCount: number
  capacity: number | null
}): { title: string; body: string } {
  const { participantCount: n, capacity } = input
  const full = capacity != null && n >= capacity
  const count = capacity != null ? `現在 ${n}名 / 定員 ${capacity}名` : `現在 ${n}名`
  return {
    title: `「${input.title}」に参加登録がありました`,
    body: full ? `${count}（定員に達しました）` : count,
  }
}

/**
 * best-effort：失敗しても参加登録そのものは成立させる（呼び出し側は after() で回す）。
 * 登録した本人が主催者を兼ねていても、本人には送らない（insertNotification が自分宛てを除く）。
 */
export async function notifyOrganizersOfJoin(input: { eventId: string; memberId: string }): Promise<number> {
  try {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!supaUrl || !serviceKey) return 0
    const admin = createSupabaseClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const [{ data: event }, { data: parts }] = await Promise.all([
      admin.from('events').select('title, capacity').eq('id', input.eventId).maybeSingle(),
      admin.from('event_participants').select('member_id, role').eq('event_id', input.eventId),
    ])
    if (!event || !parts) return 0

    const rows = parts as { member_id: string; role: string }[]
    const organizerIds = rows.filter((p) => p.role === 'organizer').map((p) => p.member_id)
    if (organizerIds.length === 0) return 0

    const notice = buildJoinNotice({
      title: (event as { title: string }).title,
      participantCount: rows.filter((p) => p.role === 'participant').length,
      capacity: (event as { capacity: number | null }).capacity,
    })

    let sent = 0
    for (const recipientId of organizerIds) {
      const r = await insertNotification({
        recipientId,
        actorId: input.memberId,
        kind: 'event',
        title: notice.title,
        body: notice.body,
        linkUrl: `/events/${input.eventId}`,
      })
      if (r.inserted) sent += 1
    }
    return sent
  } catch {
    return 0
  }
}
