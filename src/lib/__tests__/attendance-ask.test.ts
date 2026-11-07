import { describe, expect, it } from 'vitest'
import {
  ASK_LINK,
  askRecipientsFor,
  askWindow,
  buildAskNotification,
  groupAskByRecipient,
  type AskEvent,
} from '../attendance-ask'

const BOT = 'bot-1'

const ev = (over: Partial<AskEvent> = {}): AskEvent => ({
  id: 'e1',
  title: 'ちいき食堂',
  end_at: '2026-11-07T03:00:00Z',
  organizer_type: 'member',
  organizer_id: 'm1',
  organizer_name_text: 'NPO法人 Shake Hands Japan',
  external_source: null,
  submitter_member_id: null,
  ...over,
})

describe('聞く期間', () => {
  it('終わって6時間たったものから、7日前に終わったものまで', () => {
    const w = askWindow(new Date('2026-11-08T03:00:00Z'))
    expect(w.toIso).toBe('2026-11-07T21:00:00.000Z')
    expect(w.fromIso).toBe('2026-11-01T03:00:00.000Z')
  })
})

describe('聞く相手', () => {
  it('個人主催（代理登録を含む）は登録した本人', () => {
    expect(askRecipientsFor(ev(), {}, BOT)).toEqual(['m1'])
  })

  it('団体主催は代表・役員（最大5人）', () => {
    const e = ev({ organizer_type: 'org', organizer_id: 'o1', organizer_name_text: null })
    const officers = { o1: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    expect(askRecipientsFor(e, officers, BOT)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(askRecipientsFor(e, {}, BOT)).toEqual([])
  })

  it('写真の投稿者が紐づいていれば、その人にも聞く（重複は1人）', () => {
    expect(askRecipientsFor(ev({ submitter_member_id: 's1' }), {}, BOT)).toEqual(['m1', 's1'])
    expect(askRecipientsFor(ev({ submitter_member_id: 'm1' }), {}, BOT)).toEqual(['m1'])
  })

  it('外部から取り込んだ催しは聞く相手にならない（写真の投稿者だけは別）', () => {
    expect(askRecipientsFor(ev({ organizer_id: BOT, external_source: 'inzai-city-calendar' }), {}, BOT)).toEqual([])
    expect(askRecipientsFor(ev({ organizer_id: BOT, external_source: 'cocola-image-scan', submitter_member_id: 's1' }), {}, BOT)).toEqual(['s1'])
  })

  it('主催者不明（登録者は情報提供者にすぎない）には聞かない', () => {
    expect(askRecipientsFor(ev({ organizer_name_text: '主催者不明' }), {}, BOT)).toEqual([])
  })

  it('取り込み用の会員自身には送らない', () => {
    expect(askRecipientsFor(ev({ organizer_id: BOT }), {}, BOT)).toEqual([])
  })
})

describe('会員ごとにまとめる', () => {
  const members = [
    { id: 'm1', contact_preferences: {} },
    { id: 'm2', contact_preferences: { notify_event: false } },
    { id: 's1', contact_preferences: null },
  ]

  it('1人に複数の催しをまとめ、新しく終わったものを先に並べる', () => {
    const e1 = ev({ id: 'a', end_at: '2026-11-05T03:00:00Z' })
    const e2 = ev({ id: 'b', end_at: '2026-11-07T03:00:00Z' })
    const g = groupAskByRecipient([e1, e2], {}, BOT, members)
    expect([...g.keys()]).toEqual(['m1'])
    expect(g.get('m1')!.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('イベント通知を受け取らない設定の人・在籍していない人は除く', () => {
    const g = groupAskByRecipient([ev({ organizer_id: 'm2' }), ev({ id: 'x', organizer_id: 'gone' })], {}, BOT, members)
    expect(g.size).toBe(0)
  })

  it('通知設定が null でも（未設定は受け取る）送れる', () => {
    const g = groupAskByRecipient([ev({ organizer_id: 's1' })], {}, BOT, members)
    expect([...g.keys()]).toEqual(['s1'])
  })
})

describe('通知の文面', () => {
  it('1件のときは件数を付けず、リンクは人数のお願いのページ', () => {
    const n = buildAskNotification(['ちいき食堂 てとてリビング'])
    expect(n.title).toBe('参加者数を教えてください')
    expect(n.body).toContain('「ちいき食堂 てとてリビング」')
    expect(n.body).toContain('分からなければそのままで大丈夫です')
    expect(n.linkUrl).toBe(ASK_LINK)
  })

  it('複数のときは件数つきで、3件まで並べて「ほかN件」', () => {
    const n = buildAskNotification(['A', 'B', 'C', 'D', 'E'])
    expect(n.title).toBe('参加者数を教えてください（5件）')
    expect(n.body).toContain('「A」「B」「C」ほか2件')
    expect(n.body).not.toContain('「D」')
  })

  it('長い題名は切り詰める', () => {
    const n = buildAskNotification(['あ'.repeat(40)])
    expect(n.body).toContain('「' + 'あ'.repeat(24) + '…」')
  })
})
