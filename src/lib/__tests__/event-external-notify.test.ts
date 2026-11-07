import { beforeEach, describe, expect, it, vi } from 'vitest'

const notifyAllMembers = vi.fn()
vi.mock('@/lib/notify', () => ({ notifyAllMembers: (...args: unknown[]) => notifyAllMembers(...args) }))

import {
  INDIVIDUAL_MAX,
  notifyPublishedExternalEvents,
  planExternalEventNotices,
  type PublishedEvent,
} from '@/lib/event-external-notify'

// 日本時間 2026-11-07 12:00
const NOW = new Date('2026-11-07T03:00:00Z')

function ev(id: string, title: string, start_at: string, extra: Partial<PublishedEvent> = {}): PublishedEvent {
  return { id, title, start_at, location: null, online_flag: false, ...extra }
}

describe('planExternalEventNotices', () => {
  it('1件なら、会員が登録した時と同じ題名で、そのイベントへ直接つなぐ', () => {
    const n = planExternalEventNotices([ev('e1', '秋のコンサート', '2026-11-14T05:00:00Z', { location: '文化ホール' })], NOW)
    expect(n).toEqual([
      {
        title: '新しいイベント「秋のコンサート」が登録されました',
        body: '11月14日 14:00 / 文化ホール',
        linkUrl: '/events/e1',
        dedupe: true,
      },
    ])
  })

  it('オンラインのイベントは場所の代わりに「オンライン」と出す', () => {
    const [n] = planExternalEventNotices([ev('e1', 'オンライン講座', '2026-11-14T05:00:00Z', { location: '会場A', online_flag: true })], NOW)
    expect(n.body).toBe('11月14日 14:00 / オンライン')
  })

  it('もう始まっているイベントは知らせない（過去の催しの取り込みで鳴らさない）', () => {
    expect(planExternalEventNotices([ev('e1', '終わった催し', '2026-11-07T02:00:00Z')], NOW)).toEqual([])
    // ちょうど今始まる（=未来ではない）ものも知らせない
    expect(planExternalEventNotices([ev('e2', 'いま始まる', NOW.toISOString())], NOW)).toEqual([])
  })

  it('題名が空・日時が読めないものは飛ばす', () => {
    expect(
      planExternalEventNotices([ev('e1', '   ', '2026-11-14T05:00:00Z'), ev('e2', '日時不明', 'not-a-date')], NOW),
    ).toEqual([])
  })

  it('同じ題名（複数日程）は1通にまとめ、いちばん早い日程のイベントへつなぐ', () => {
    const n = planExternalEventNotices(
      [
        ev('late', 'ワークショップ', '2026-11-28T05:00:00Z'),
        ev('early', 'ワークショップ', '2026-11-14T05:00:00Z'),
        ev('mid', 'ワークショップ', '2026-11-21T05:00:00Z'),
      ],
      NOW,
    )
    expect(n).toHaveLength(1)
    expect(n[0].linkUrl).toBe('/events/early')
    expect(n[0].body).toBe('11月14日 14:00 ほか全3回')
  })

  it(`題名が${INDIVIDUAL_MAX}種類までなら、種類ごとに1通ずつ（開始が早い順）`, () => {
    const n = planExternalEventNotices(
      [ev('c', 'C', '2026-11-20T05:00:00Z'), ev('a', 'A', '2026-11-10T05:00:00Z'), ev('b', 'B', '2026-11-15T05:00:00Z')],
      NOW,
    )
    expect(n.map((x) => x.linkUrl)).toEqual(['/events/a', '/events/b', '/events/c'])
    expect(n.every((x) => x.dedupe)).toBe(true)
  })

  it(`題名が${INDIVIDUAL_MAX}種類を超えたら「N件」の1通にまとめる（広報いんざい1号の約70件でも鳴るのは1回）`, () => {
    const events = Array.from({ length: 70 }, (_, i) => ev(`e${i}`, `催し${i}`, `2026-12-${String((i % 28) + 1).padStart(2, '0')}T05:00:00Z`))
    const n = planExternalEventNotices(events, NOW)
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('新しいイベントが70件 登録されました')
    expect(n[0].linkUrl).toBe('/events')
    expect(n[0].dedupe).toBe(false)
    expect(n[0].body).toMatch(/ほか67件$/)
  })

  it('まとめの本文は、開始が早い順に題名を3つまで並べる', () => {
    const n = planExternalEventNotices(
      [
        ev('4', 'ええ', '2026-11-25T05:00:00Z'),
        ev('1', 'あ', '2026-11-10T05:00:00Z'),
        ev('3', 'うう', '2026-11-20T05:00:00Z'),
        ev('2', 'いい', '2026-11-15T05:00:00Z'),
      ],
      NOW,
    )
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('新しいイベントが4件 登録されました')
    expect(n[0].body).toBe('「あ」「いい」「うう」ほか1件')
  })

  it('過去のものは数えない：未来が3種類以下なら、過去が混じっていても1件ずつ出す', () => {
    const n = planExternalEventNotices(
      [
        ev('p1', '過去1', '2026-11-01T05:00:00Z'),
        ev('p2', '過去2', '2026-11-02T05:00:00Z'),
        ev('f1', '未来1', '2026-11-12T05:00:00Z'),
        ev('f2', '未来2', '2026-11-13T05:00:00Z'),
      ],
      NOW,
    )
    expect(n.map((x) => x.linkUrl)).toEqual(['/events/f1', '/events/f2'])
  })
})

describe('notifyPublishedExternalEvents', () => {
  beforeEach(() => {
    notifyAllMembers.mockReset()
    notifyAllMembers.mockResolvedValue({ recipients: 1, pushed: 0, broadcastId: 'b' })
  })

  it('『その都度』の人にだけ（notify_event・event_notify_mode を見て）、種類 event で全体通知を出す', async () => {
    const r = await notifyPublishedExternalEvents([ev('e1', '秋のコンサート', '2026-11-14T05:00:00Z')], { now: NOW })
    expect(r).toEqual({ notices: 1 })
    expect(notifyAllMembers).toHaveBeenCalledTimes(1)
    const arg = notifyAllMembers.mock.calls[0][0]
    expect(arg.kind).toBe('event')
    expect(arg.prefKey).toBe('notify_event')
    expect(arg.title).toBe('新しいイベント「秋のコンサート」が登録されました')
    expect(arg.linkUrl).toBe('/events/e1')
    expect(arg.dedupeMinutes).toBe(24 * 60)
    // 宛先の条件：未設定・その都度は送る／まとめ・受け取らないは送らない
    expect(arg.recipientFilter({})).toBe(true)
    expect(arg.recipientFilter({ event_notify_mode: 'instant' })).toBe(true)
    expect(arg.recipientFilter({ event_notify_mode: 'digest' })).toBe(false)
    expect(arg.recipientFilter({ notify_event: false })).toBe(false)
  })

  it('操作した運営（actorId）には送らない。渡さなければ除外なし', async () => {
    await notifyPublishedExternalEvents([ev('e1', 'A', '2026-11-14T05:00:00Z')], { now: NOW, actorId: 'admin-1' })
    expect(notifyAllMembers.mock.calls[0][0].actorId).toBe('admin-1')
    notifyAllMembers.mockClear()
    await notifyPublishedExternalEvents([ev('e1', 'A', '2026-11-14T05:00:00Z')], { now: NOW })
    expect(notifyAllMembers.mock.calls[0][0].actorId).toBeNull()
  })

  it('「N件」のまとめは dedupe しない（日をまたいだ別のまとめを止めない）', async () => {
    const events = ['A', 'B', 'C', 'D'].map((t, i) => ev(`e${i}`, t, `2026-11-1${i}T05:00:00Z`))
    await notifyPublishedExternalEvents(events, { now: NOW })
    expect(notifyAllMembers).toHaveBeenCalledTimes(1)
    expect(notifyAllMembers.mock.calls[0][0].dedupeMinutes).toBeUndefined()
  })

  it('知らせるものが無ければ何も送らない（空・過去のみ）', async () => {
    expect(await notifyPublishedExternalEvents([], { now: NOW })).toEqual({ notices: 0 })
    expect(await notifyPublishedExternalEvents([ev('e1', '過去', '2026-11-01T05:00:00Z')], { now: NOW })).toEqual({ notices: 0 })
    expect(notifyAllMembers).not.toHaveBeenCalled()
  })

  it('送信が失敗しても例外を投げない（取り込み・公開の処理を止めない）', async () => {
    notifyAllMembers.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyPublishedExternalEvents([ev('e1', 'A', '2026-11-14T05:00:00Z')], { now: NOW })).resolves.toEqual({ notices: 0 })
    spy.mockRestore()
  })
})
