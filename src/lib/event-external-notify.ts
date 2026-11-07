// 外部から取り込まれたイベントが、会員に見える状態（公開中）になった時に、
// 『その都度』を選んでいる会員へ知らせる。
//
// 呼ぶ場所は「会員に見えるようになった瞬間」の4か所：
//   ・文化ホール同期（status='open' で入れる）
//   ・/api/events/ingest（COCoLa の画像スキャン）
//   ・管理画面の一括取り込み（チラシ・広報いんざい）
//   ・管理画面の「候補を公開」（市カレンダー・号外・Instagram は下書きで入り、公開した時に見える）
// 下書き（draft）の間は会員に見えないので、ここでは知らせない。
//
// 『毎日18時にまとめて』の人は /api/cron/event-digest が受け持つので、ここでは送らない（wantsInstantEvent）。
// 一度に大量に入る場合（広報いんざい1号で約70件など）に1件ずつ鳴らさないよう、
// 題名が INDIVIDUAL_MAX 種類を超えたら「N件」の1通にまとめる。

import { formatJstShort } from '@/lib/event-reminder'
import { wantsInstantEvent } from '@/lib/event-notify-mode'
import { groupByTitle, LIST_MAX, shortTitle, type DigestEvent } from '@/lib/event-digest'
import { notifyAllMembers } from '@/lib/notify'

/** 1回の呼び出しで、題名が何種類までなら1件ずつ知らせるか（超えたら「N件」の1通） */
export const INDIVIDUAL_MAX = 3

/** 同じイベントへの通知を二度送らない時間（分）。呼び出しが重なっても、1件ずつの通知は1日1回まで */
const DEDUPE_MINUTES = 24 * 60

export type PublishedEvent = {
  id: string
  title: string
  start_at: string
  location?: string | null
  online_flag?: boolean | null
}

export type ExternalEventNotice = {
  title: string
  body: string
  linkUrl: string
  /** true なら linkUrl が同じ通知を重ねて送らない（1件ずつの通知）。「N件」のまとめは日をまたいで同じ宛先になるので false */
  dedupe: boolean
}

function describeGroup(group: DigestEvent[]): string {
  const first = group[0]
  const when = formatJstShort(first.start_at)
  const where = first.online_flag ? 'オンライン' : (first.location ?? '').trim()
  return [group.length > 1 ? `${when} ほか全${group.length}回` : when, where].filter(Boolean).join(' / ')
}

/**
 * 送る通知の中身を決める（DBなしで試せる純粋な関数）。
 * - まだ始まっていないイベントだけ（過去の催しの取り込みは知らせない）
 * - 同じ題名（複数日程）は1つにまとめ、最初の日程のイベントへつなぐ
 * - 題名が INDIVIDUAL_MAX 種類以内なら1種類ごとに1通、超えたら「新しいイベントがN件」の1通（一覧へつなぐ）
 */
export function planExternalEventNotices(events: PublishedEvent[], now: Date): ExternalEventNotice[] {
  const upcoming: DigestEvent[] = events
    .filter((e) => {
      const t = new Date(e.start_at).getTime()
      return e.title.trim() !== '' && !Number.isNaN(t) && t > now.getTime()
    })
    .map((e) => ({
      id: e.id,
      title: e.title,
      start_at: e.start_at,
      location: e.location ?? null,
      online_flag: !!e.online_flag,
    }))
  if (upcoming.length === 0) return []

  const groups = groupByTitle(upcoming)
  if (groups.length <= INDIVIDUAL_MAX) {
    return groups.map((g) => ({
      title: `新しいイベント「${g[0].title.trim()}」が登録されました`,
      body: describeGroup(g),
      linkUrl: `/events/${g[0].id}`,
      dedupe: true,
    }))
  }

  const shown = groups.slice(0, LIST_MAX).map((g) => `「${shortTitle(g[0].title)}」`)
  const rest = groups.length - LIST_MAX
  return [
    {
      title: `新しいイベントが${groups.length}件 登録されました`,
      body: rest > 0 ? `${shown.join('')}ほか${rest}件` : shown.join(''),
      linkUrl: '/events',
      dedupe: false,
    },
  ]
}

/**
 * 公開された外部イベントを、『その都度』の会員へ知らせる（ベル＋プッシュ）。
 * best-effort：失敗しても、取り込み・公開の処理は成立させる（例外は投げない）。
 * actorId を渡すと、その人（取り込みを操作した運営）には送らない。
 */
export async function notifyPublishedExternalEvents(
  events: PublishedEvent[],
  opts: { actorId?: string | null; now?: Date } = {},
): Promise<{ notices: number }> {
  try {
    const notices = planExternalEventNotices(events, opts.now ?? new Date())
    for (const n of notices) {
      await notifyAllMembers({
        kind: 'event',
        actorId: opts.actorId ?? null,
        prefKey: 'notify_event',
        recipientFilter: wantsInstantEvent,
        title: n.title,
        body: n.body || undefined,
        linkUrl: n.linkUrl,
        dedupeMinutes: n.dedupe ? DEDUPE_MINUTES : undefined,
      })
    }
    return { notices: notices.length }
  } catch (e) {
    console.error('[event-external-notify] failed:', e instanceof Error ? e.message : String(e))
    return { notices: 0 }
  }
}
