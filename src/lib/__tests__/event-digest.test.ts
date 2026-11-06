import { describe, expect, it } from 'vitest'
import { buildEventDigest, digestMarker, digestWindow, pickDigestRecipients, type DigestEvent } from '@/lib/event-digest'

function ev(id: string, title: string, start_at: string, extra: Partial<DigestEvent> = {}): DigestEvent {
  return { id, title, start_at, location: null, online_flag: false, ...extra }
}

describe('digestWindow', () => {
  it('18:00（日本時間）ちょうど・少し遅れても、前日18:00〜当日18:00の同じ窓になる', () => {
    const w1 = digestWindow(new Date('2026-11-07T09:00:00Z')) // 日本時間 11/7 18:00
    const w2 = digestWindow(new Date('2026-11-07T09:00:42Z'))
    expect(w1).toEqual({ fromIso: '2026-11-06T09:00:00.000Z', toIso: '2026-11-07T09:00:00.000Z', dateKey: '20261107' })
    expect(w2).toEqual(w1)
  })

  it('窓は24時間で、毎日つながる（重ならず、抜けない）', () => {
    const d1 = digestWindow(new Date('2026-11-07T09:00:00Z'))
    const d2 = digestWindow(new Date('2026-11-08T09:00:00Z'))
    expect(d2.fromIso).toBe(d1.toIso)
    expect(new Date(d1.toIso).getTime() - new Date(d1.fromIso).getTime()).toBe(24 * 3600_000)
  })

  it('18時より前に手で動かしたときは、前日のまとめの窓になる（朝に動かしても未来の窓にならない）', () => {
    const w = digestWindow(new Date('2026-11-07T01:00:00Z')) // 日本時間 11/7 10:00
    expect(w.toIso).toBe('2026-11-06T09:00:00.000Z')
    expect(w.dateKey).toBe('20261106')
  })

  it('日本時間の日付で数える（UTCでは前日でも日本では当日）', () => {
    // 日本時間 12/1 18:00 = UTC 12/1 09:00。月またぎ
    expect(digestWindow(new Date('2026-12-01T09:00:00Z')).dateKey).toBe('20261201')
    expect(digestWindow(new Date('2026-12-01T08:59:59Z')).dateKey).toBe('20261130')
  })
})

describe('buildEventDigest', () => {
  const key = '20261107'

  it('1件だけなら、その場で出す通知と同じ題名にして、そのイベントへ直接つなぐ', () => {
    const d = buildEventDigest(
      [ev('e1', '図書館まつり', '2026-11-14T05:00:00Z', { location: '印西市立中央駅前図書館' })],
      key,
    )
    expect(d.title).toBe('新しいイベント「図書館まつり」が登録されました')
    expect(d.body).toBe('11月14日 14:00 / 印西市立中央駅前図書館')
    expect(d.linkUrl).toBe(`/events/e1${digestMarker(key)}`)
  })

  it('オンラインのイベントは場所の代わりに「オンライン」', () => {
    const d = buildEventDigest([ev('e1', '勉強会', '2026-11-14T05:00:00Z', { online_flag: true, location: '無視される' })], key)
    expect(d.body).toBe('11月14日 14:00 / オンライン')
  })

  it('同じ題名の複数日程は1つにまとめ、最初の日と全N回を出す', () => {
    const d = buildEventDigest(
      [
        ev('e2', '朝市', '2026-11-21T00:00:00Z'),
        ev('e1', '朝市', '2026-11-14T00:00:00Z'),
        ev('e3', '朝市', '2026-11-28T00:00:00Z'),
      ],
      key,
    )
    expect(d.title).toBe('新しいイベント「朝市」が登録されました')
    expect(d.body).toBe('11月14日 09:00 ほか全3回')
    expect(d.linkUrl).toBe(`/events/e1${digestMarker(key)}`) // いちばん早い日程
  })

  it('題名が2種類以上なら件数と題名（開始が早い順に3つまで）。一覧へつなぐ', () => {
    const d = buildEventDigest(
      [
        ev('a', 'D', '2026-11-20T00:00:00Z'),
        ev('b', 'A', '2026-11-10T00:00:00Z'),
        ev('c', 'C', '2026-11-12T00:00:00Z'),
        ev('d', 'B', '2026-11-11T00:00:00Z'),
        ev('e', 'E', '2026-11-30T00:00:00Z'),
      ],
      key,
    )
    expect(d.title).toBe('新しいイベントが5件 登録されました')
    expect(d.body).toBe('「A」「B」「C」ほか2件')
    expect(d.linkUrl).toBe(`/events${digestMarker(key)}`)
  })

  it('ちょうど3種類なら「ほか」を付けない。長い題名は切る', () => {
    const long = 'あ'.repeat(30)
    const d = buildEventDigest(
      [ev('a', long, '2026-11-10T00:00:00Z'), ev('b', 'B', '2026-11-11T00:00:00Z'), ev('c', 'C', '2026-11-12T00:00:00Z')],
      key,
    )
    expect(d.title).toBe('新しいイベントが3件 登録されました')
    expect(d.body).toBe(`「${'あ'.repeat(23)}…」「B」「C」`)
  })
})

describe('pickDigestRecipients', () => {
  const members = [
    { id: 'instant', contact_preferences: { notify_event: true, event_notify_mode: 'instant' } },
    { id: 'unset', contact_preferences: {} },
    { id: 'digest1', contact_preferences: { notify_event: true, event_notify_mode: 'digest' } },
    { id: 'digest2', contact_preferences: { event_notify_mode: 'digest' } },
    { id: 'off', contact_preferences: { notify_event: false, event_notify_mode: 'off' } },
    { id: 'offLegacy', contact_preferences: { notify_event: false, event_notify_mode: 'digest' } },
    { id: 'digest1', contact_preferences: { event_notify_mode: 'digest' } }, // 重複
  ]

  it('『毎日まとめて』の人だけ。その都度・未設定・受け取らない人は含めない。重複は1通', () => {
    expect(pickDigestRecipients({ members, alreadyNotified: new Set() })).toEqual(['digest1', 'digest2'])
  })

  it('その日のまとめを受け取った人には送らない（再実行しても重複しない）', () => {
    expect(pickDigestRecipients({ members, alreadyNotified: new Set(['digest1']) })).toEqual(['digest2'])
  })
})
