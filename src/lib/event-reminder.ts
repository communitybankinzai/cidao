// イベント前日リマインド（/api/cron/event-reminder）の純粋な部品。
// 日付の窓・本文・宛先の選別を route から切り出して、DB なしで試せるようにする。

const JST_OFFSET_MS = 9 * 3600_000
const DAY_MS = 24 * 3600_000

/**
 * 「いま」の次の日本時間の1日分（0:00〜翌0:00）を UTC の ISO 文字列で返す。
 * 朝のうちに動かせば「あした始まるイベント」だけが窓に入る。
 * 例：2026-11-06T23:12Z（日本時間 11/7 8:12）→ 2026-11-07T15:00Z〜2026-11-08T15:00Z（日本時間 11/8 の1日）
 */
export function nextJstDayWindow(now: Date): { fromIso: string; toIso: string } {
  const jstShifted = now.getTime() + JST_OFFSET_MS
  const todayJstMidnightShifted = Math.floor(jstShifted / DAY_MS) * DAY_MS
  const from = todayJstMidnightShifted + DAY_MS - JST_OFFSET_MS
  return {
    fromIso: new Date(from).toISOString(),
    toIso: new Date(from + DAY_MS).toISOString(),
  }
}

/** 通知の link_url。同じ値の通知を持つ人には二度送らない（再実行しても重複しない）ための目印を兼ねる */
export function reminderLink(eventId: string): string {
  return `/events/${eventId}#remind-1d`
}

/** UTC の ISO 文字列 → 日本時間の「11月8日 14:00」 */
export function formatJstShort(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const j = new Date(t.getTime() + JST_OFFSET_MS)
  const hh = String(j.getUTCHours()).padStart(2, '0')
  const mm = String(j.getUTCMinutes()).padStart(2, '0')
  return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日 ${hh}:${mm}`
}

export type ReminderEvent = {
  id: string
  title: string
  start_at: string
  location: string | null
  online_flag: boolean
}

export function buildEventReminder(ev: ReminderEvent): { title: string; body: string; linkUrl: string } {
  const where = ev.online_flag ? 'オンライン' : (ev.location ?? '').trim()
  return {
    title: `明日のイベント「${ev.title}」`,
    body: [`${formatJstShort(ev.start_at)}〜`, where].filter(Boolean).join(' / '),
    linkUrl: reminderLink(ev.id),
  }
}

export type ReminderMember = { id: string; contact_preferences: unknown }

/**
 * リマインドを送る相手を決める。
 * - 在籍している人だけ（members に渡された人が在籍者）
 * - 設定で「イベント通知を受け取る」を外した人は送らない（意図的な選択を尊重する）
 * - すでに同じリマインドを受け取った人には送らない
 */
export function pickReminderRecipients(input: {
  participantIds: string[]
  members: ReminderMember[]
  alreadyNotified: ReadonlySet<string>
}): string[] {
  const activeById = new Map(input.members.map((m) => [m.id, m]))
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of input.participantIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const m = activeById.get(id)
    if (!m) continue
    const prefs = (m.contact_preferences ?? {}) as Record<string, unknown>
    if (prefs.notify_event === false) continue
    if (input.alreadyNotified.has(id)) continue
    result.push(id)
  }
  return result
}
