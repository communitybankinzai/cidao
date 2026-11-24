// 管理画面 /admin/sns の承認待ち一覧：イベント詳細の「📣 SNSで告知」から来たとき
// （?event=<ID>）に、そのイベントの下書きだけを出すか
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// 下書きの編集部品はサーバーアクションを読むので、表示確認では題名だけ出す代役にする
vi.mock('@/app/admin/sns/_components/SnsDraftEditor', () => ({
  default: ({ log }: { log: { title: string; mediumLabel: string } }) =>
    createElement('li', null, `card:${log.title}/${log.mediumLabel}`),
}))

import AwaitingList from '@/app/admin/sns/_components/AwaitingList'

const base = { content: '本文', approved_at: null, consentNote: undefined, heldWithin24h: false }
const logs = [
  { ...base, id: '1', target_type: 'event', target_id: 'ev-a', medium: 'threads', created_at: '2026-11-24T01:00:00Z', title: '秋まつり', mediumLabel: '🧵 Threads', targetLabel: '📅 イベント' },
  { ...base, id: '2', target_type: 'event', target_id: 'ev-a', medium: 'facebook', created_at: '2026-11-24T01:00:01Z', title: '秋まつり', mediumLabel: '📘 FB', targetLabel: '📅 イベント' },
  { ...base, id: '3', target_type: 'event', target_id: 'ev-b', medium: 'threads', created_at: '2026-11-23T01:00:00Z', title: '冬の講座', mediumLabel: '🧵 Threads', targetLabel: '📅 イベント' },
  { ...base, id: '4', target_type: 'freefree', target_id: 'ev-a', medium: 'threads', created_at: '2026-11-22T01:00:00Z', title: 'FreeFreeの品', mediumLabel: '🧵 Threads', targetLabel: '🛍 FreeFree' },
]

const html = (focusEventId?: string) =>
  renderToStaticMarkup(createElement(AwaitingList, { logs, focusEventId } as never))

describe('承認待ち一覧のイベント絞り込み', () => {
  it('?event= が無ければ、今までどおり全件を出し、絞り込みの帯は出さない', () => {
    const h = html()
    expect(h).toContain('card:秋まつり/🧵 Threads')
    expect(h).toContain('card:冬の講座')
    expect(h).toContain('card:FreeFreeの品')
    expect(h).not.toContain('だけを表示しています')
  })
  it('?event= があれば、そのイベントの下書きだけを出す（同じIDの別種類は出さない）', () => {
    const h = html('ev-a')
    expect(h).toContain('card:秋まつり/🧵 Threads')
    expect(h).toContain('card:秋まつり/📘 FB')
    expect(h).not.toContain('card:冬の講座')
    expect(h).not.toContain('card:FreeFreeの品')
    expect(h).toContain('イベント「秋まつり」の下書きだけを表示しています（2 件）')
    expect(h).toContain('承認待ちをすべて表示（4 件）')
  })
  it('該当の下書きが無いイベントなら、その旨と「すべて表示」を出す', () => {
    const h = html('ev-zzz')
    expect(h).toContain('このイベントの承認待ちの下書きはありません')
    expect(h).toContain('承認待ちをすべて表示（4 件）')
  })
})
