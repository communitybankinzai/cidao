// 開催後の参加者数のお願い（/api/cron/attendance-ask）の純粋な部品。
// 「どの催しを・誰に・どんな文面で聞くか」を route から切り出して、DB なしで試せるようにする。
//
// 方針：
//  - 対象は「子どもの居場所」の目印がある催しで、開催が終わり、参加者数がまだ空のもの
//  - 聞く相手はイベントを登録した人（個人主催なら本人、団体主催なら代表・役員、写真投稿者）。1人に1通へまとめる
//  - 外部から取り込んだ催し（取り込み用の会員が主催）と『主催者不明』は聞く相手がいないので対象外（運営の聞き取りで入れる）
//  - 同じ催しには1回だけ（events.attendee_asked_at）。しつこく繰り返さない

export const ASK_LINK = '/me/attendance'

const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

// 終わって6時間たったものから、7日前までに終わったものを聞く（それより前の分は運営の聞き取りで）
export const ASK_MIN_HOURS_AFTER_END = 6
export const ASK_MAX_DAYS_AFTER_END = 7
// 団体主催のとき、1つの催しで通知する代表・役員の最大人数
export const ASK_MAX_OFFICERS_PER_ORG = 5
// 通知の本文に並べる催しの数
export const ASK_BODY_TITLES = 3

export function askWindow(now: Date): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(now.getTime() - ASK_MAX_DAYS_AFTER_END * DAY_MS).toISOString(),
    toIso: new Date(now.getTime() - ASK_MIN_HOURS_AFTER_END * HOUR_MS).toISOString(),
  }
}

export type AskEvent = {
  id: string
  title: string
  end_at: string
  organizer_type: 'member' | 'org'
  organizer_id: string
  organizer_name_text: string | null
  external_source: string | null
  submitter_member_id: string | null
}

export const UNKNOWN_ORGANIZER_NAME = '主催者不明'

/**
 * 1つの催しについて、聞く相手の会員IDを返す（重複なし）。
 * officersByOrg は団体ID → 代表・役員（confirmed）の会員ID。
 */
export function askRecipientsFor(
  ev: AskEvent,
  officersByOrg: Readonly<Record<string, readonly string[]>>,
  botMemberId: string,
): string[] {
  if ((ev.organizer_name_text ?? '').trim() === UNKNOWN_ORGANIZER_NAME) return []
  const ids: string[] = []
  // 外部から取り込んだ催しは、主催が取り込み用の会員なので聞く相手にならない（写真の投稿者が紐づいていればその人だけ）
  if (!ev.external_source) {
    if (ev.organizer_type === 'member') ids.push(ev.organizer_id)
    else ids.push(...(officersByOrg[ev.organizer_id] ?? []).slice(0, ASK_MAX_OFFICERS_PER_ORG))
  }
  if (ev.submitter_member_id) ids.push(ev.submitter_member_id)
  return [...new Set(ids)].filter((id) => id && id !== botMemberId)
}

export type AskMember = { id: string; contact_preferences: unknown }

/** 会員ごとに、聞く催しをまとめる。在籍していない人と、イベント通知を受け取らない設定の人は除く */
export function groupAskByRecipient(
  events: readonly AskEvent[],
  officersByOrg: Readonly<Record<string, readonly string[]>>,
  botMemberId: string,
  members: readonly AskMember[],
): Map<string, AskEvent[]> {
  const active = new Map(members.map((m) => [m.id, m]))
  const out = new Map<string, AskEvent[]>()
  for (const ev of events) {
    for (const id of askRecipientsFor(ev, officersByOrg, botMemberId)) {
      const m = active.get(id)
      if (!m) continue
      const prefs = (m.contact_preferences ?? {}) as Record<string, unknown>
      if (prefs.notify_event === false) continue
      const list = out.get(id) ?? []
      list.push(ev)
      out.set(id, list)
    }
  }
  // 新しく終わったものから並べる
  for (const list of out.values()) list.sort((a, b) => b.end_at.localeCompare(a.end_at))
  return out
}

/** 通知の文面。何件でも1通。会員の名前は出さない */
export function buildAskNotification(titles: readonly string[]): { title: string; body: string; linkUrl: string } {
  const n = titles.length
  const shown = titles.slice(0, ASK_BODY_TITLES).map((t) => `「${t.length > 24 ? t.slice(0, 24) + '…' : t}」`)
  const rest = n > ASK_BODY_TITLES ? `ほか${n - ASK_BODY_TITLES}件` : ''
  return {
    title: n === 1 ? '参加者数を教えてください' : `参加者数を教えてください（${n}件）`,
    body: `${shown.join('')}${rest}。実際に来た人数を入れると、こどもの居場所カレンダーの実績に反映されます。分からなければそのままで大丈夫です。`,
    linkUrl: ASK_LINK,
  }
}
