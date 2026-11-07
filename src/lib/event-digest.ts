// 新着イベントの「毎日18時のまとめ」（/api/cron/event-digest）の純粋な部品。
// 日付の窓・文面・宛先の選別を route から切り出して、DB なしで試せるようにする。
//
// 対象は『毎日18時にまとめて』を選んだ会員。前日18:00〜当日18:00（日本時間）に新しく載った
// 公開中のイベントを、1通にまとめて知らせる。会員が登録した分も、外部から取り込んだ分も含む。

import { formatJstShort } from '@/lib/event-reminder'
import { wantsEventDigest } from '@/lib/event-notify-mode'

const JST_OFFSET_MS = 9 * 3600_000
const DAY_MS = 24 * 3600_000
export const DIGEST_HOUR_JST = 18

/**
 * 直近の日本時間18:00を終わりとする、24時間の窓（作成日時で数える）。
 * 18:00ちょうどより少し遅れて動いても、同じ窓になる（毎日の窓が重ならず、抜けない）。
 * 例：2026-11-07T09:00:03Z（日本時間 11/7 18:00）→ 11/6 18:00〜11/7 18:00（日本時間）、dateKey=20261107
 */
export function digestWindow(now: Date): { fromIso: string; toIso: string; dateKey: string } {
  const jst = now.getTime() + JST_OFFSET_MS
  let endShifted = Math.floor(jst / DAY_MS) * DAY_MS + DIGEST_HOUR_JST * 3600_000
  if (jst < endShifted) endShifted -= DAY_MS
  const toMs = endShifted - JST_OFFSET_MS
  return {
    fromIso: new Date(toMs - DAY_MS).toISOString(),
    toIso: new Date(toMs).toISOString(),
    dateKey: new Date(endShifted).toISOString().slice(0, 10).replace(/-/g, ''),
  }
}

/** 通知の link_url の末尾。同じ日のまとめを受け取った人には二度送らない（再実行しても重複しない）目印を兼ねる */
export function digestMarker(dateKey: string): string {
  return `#digest-${dateKey}`
}

export type DigestEvent = {
  id: string
  title: string
  start_at: string
  location: string | null
  online_flag: boolean
}

/** 同じ題名のイベント（複数日程の登録など）は1つにまとめ、開始が早い順に並べる */
export function groupByTitle(events: DigestEvent[]): DigestEvent[][] {
  const byTitle = new Map<string, DigestEvent[]>()
  for (const e of events) {
    const key = e.title.trim()
    const arr = byTitle.get(key) ?? []
    arr.push(e)
    byTitle.set(key, arr)
  }
  const groups = [...byTitle.values()].map((g) => [...g].sort((a, b) => a.start_at.localeCompare(b.start_at)))
  groups.sort((a, b) => a[0].start_at.localeCompare(b[0].start_at))
  return groups
}

export function shortTitle(t: string): string {
  const s = t.trim()
  return s.length > 24 ? `${s.slice(0, 23)}…` : s
}

export const LIST_MAX = 3 // 本文に題名を並べる最大数（残りは「ほかN件」）

/**
 * まとめ通知の文面。
 * - 題名が1種類だけなら、その場で出す通知（新しいイベント「X」が登録されました）と同じ形にして、そのイベントへ直接つなぐ
 * - 2種類以上なら「新しいイベントが N件 登録されました」＋題名を3つまで。一覧（/events）へつなぐ
 * events は1件以上であること（0件のときは呼ばない）
 */
export function buildEventDigest(events: DigestEvent[], dateKey: string): { title: string; body: string; linkUrl: string } {
  const marker = digestMarker(dateKey)
  const groups = groupByTitle(events)

  if (groups.length === 1) {
    const g = groups[0]
    const first = g[0]
    const when = formatJstShort(first.start_at)
    const where = first.online_flag ? 'オンライン' : (first.location ?? '').trim()
    return {
      title: `新しいイベント「${first.title.trim()}」が登録されました`,
      body: [g.length > 1 ? `${when} ほか全${g.length}回` : when, where].filter(Boolean).join(' / '),
      linkUrl: `/events/${first.id}${marker}`,
    }
  }

  const shown = groups.slice(0, LIST_MAX).map((g) => `「${shortTitle(g[0].title)}」`)
  const rest = groups.length - LIST_MAX
  return {
    title: `新しいイベントが${groups.length}件 登録されました`,
    body: rest > 0 ? `${shown.join('')}ほか${rest}件` : shown.join(''),
    linkUrl: `/events${marker}`,
  }
}

export type DigestMember = { id: string; contact_preferences: unknown }

/**
 * まとめを送る相手を決める。
 * - 『毎日18時にまとめて』を選んだ人だけ（その都度の人にはすぐ送ってあり、受け取らない人には送らない）
 * - すでにその日のまとめを受け取った人には送らない
 */
export function pickDigestRecipients(input: {
  members: DigestMember[]
  alreadyNotified: ReadonlySet<string>
}): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of input.members) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    if (!wantsEventDigest(m.contact_preferences)) continue
    if (input.alreadyNotified.has(m.id)) continue
    result.push(m.id)
  }
  return result
}
