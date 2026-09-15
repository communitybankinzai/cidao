import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildCalendarUrl,
  parseCalendarHtml,
  parseFeeText,
  parseTimeText,
  toEventDescription,
  upcomingMonths,
} from '../calendar'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8')

describe('parseCalendarHtml（2026-09 実サイトの固定HTML）', () => {
  const entries = parseCalendarHtml(fixture('calendar-2026-09.html'), 2026, 9)

  it('主催公演と貸館公演の両方を拾う', () => {
    expect(entries.length).toBeGreaterThanOrEqual(6)
    const rental = entries.find((e) => e.title === 'ピアノ発表会')
    expect(rental).toMatchObject({
      date: '2026-09-12',
      detailUrl: null,
      isSyusai: false,
      venue: 'ホール',
      organizer: 'Cuoreピアノ教室',
      startAt: '2026-09-12T13:00',
      endAt: '2026-09-12T15:00',
      fee: 0,
    })
    expect(rental?.sourceId).toMatch(/^cal:2026-09-12:[0-9a-f]{12}$/)
  })

  it('主催公演は詳細URLと投稿IDつきの sourceId を持つ', () => {
    const e = entries.find((x) => x.title === 'フライデーナイトコンサートVol.15')
    expect(e).toMatchObject({
      date: '2026-09-18',
      detailUrl: 'https://www.inzai-bunka.jp/event/38056/',
      isSyusai: true,
      startAt: '2026-09-18T19:30',
      endAt: '2026-09-18T21:30',
      fee: 1000,
      sourceId: 'post:38056:2026-09-18',
    })
    expect(e?.feeText).toContain('高校生以下：500円')
    expect(e?.contact).toContain('0476-42-8811')
  })

  it('同じ日に2件ある欄は2件に分ける', () => {
    const sep20 = entries.filter((e) => e.date === '2026-09-20')
    expect(sep20.length).toBe(2)
    expect(new Set(sep20.map((e) => e.sourceId)).size).toBe(2)
  })

  it('同じ入力からは同じ sourceId が出る（再取得しても重複登録にならない）', () => {
    const again = parseCalendarHtml(fixture('calendar-2026-09.html'), 2026, 9)
    expect(again.map((e) => e.sourceId)).toEqual(entries.map((e) => e.sourceId))
  })

  it('説明文には出典URLが必ず入る', () => {
    const rental = entries.find((e) => e.title === 'ピアノ発表会')!
    const desc = toEventDescription(rental, buildCalendarUrl(2026, 9))
    expect(desc).toContain('【主催】Cuoreピアノ教室')
    expect(desc).toContain('https://www.inzai-bunka.jp/event_calendar/?year_select=2026&month_select=9')
  })
})

describe('parseCalendarHtml（2026-10）', () => {
  const entries = parseCalendarHtml(fixture('calendar-2026-10.html'), 2026, 10)

  it('複数回公演は最初の開演を開始、最後の時刻を終了にする', () => {
    const e = entries.find((x) => x.title.includes('ものまねLIVE'))
    expect(e?.date).toBe('2026-10-12')
    expect(e?.startAt).toBe('2026-10-12T14:00')
    expect((e?.endAt ?? '') >= '2026-10-12T16:00').toBe(true)
  })

  it('カレンダーは「ホール」の催しだけを載せる（多目的室の主催公演は無い）', () => {
    expect(entries.find((x) => x.title === 'いんざい手仕事工房')).toBeUndefined()
    expect(entries.every((x) => x.venue === 'ホール')).toBe(true)
  })
})

describe('構造が違うHTML', () => {
  it('表が無ければ空配列を返し例外を投げない', () => {
    expect(parseCalendarHtml('<html><body>メンテナンス中</body></html>', 2026, 9)).toEqual([])
  })
})

describe('parseTimeText', () => {
  it('開演を開始にし、終了が無ければ +2時間', () => {
    expect(parseTimeText('開場 19:00 ／ 開演 19:30')).toEqual({ start: '19:30', end: '21:30', assumed: false })
  })
  it('終了があればそれを使う', () => {
    expect(parseTimeText('受付開始 12:45 ／ 開始 13:00 ／ 終了 14:30 (予定)')).toEqual({ start: '13:00', end: '14:30', assumed: false })
  })
  it('範囲表記は最初と最後', () => {
    expect(parseTimeText('①10:00～10:25 ②10:30～10:55 ③11:00～11:25')).toEqual({ start: '10:00', end: '12:00', assumed: false })
    expect(parseTimeText('10:30～12:00(予定)')).toEqual({ start: '10:30', end: '12:30', assumed: false })
  })
  it('時刻が無ければ仮置き', () => {
    expect(parseTimeText('')).toEqual({ start: '09:00', end: '17:00', assumed: true })
  })
  it('全角数字も読む', () => {
    expect(parseTimeText('開演 １４：００')).toEqual({ start: '14:00', end: '16:00', assumed: false })
  })
})

describe('parseFeeText', () => {
  it('金額・無料・不明', () => {
    expect(parseFeeText('全席指定（税込）\n一般：1,000円\n高校生以下：500円')).toBe(1000)
    expect(parseFeeText('入場無料・要整理券')).toBe(0)
    expect(parseFeeText('入場無料 優先入場 1,000円(要予約)')).toBe(1000)
    expect(parseFeeText('')).toBeNull()
  })
})

describe('upcomingMonths', () => {
  it('JST の年月で数え、年をまたぐ', () => {
    // 2026-11-30 23:30 UTC = 2026-12-01 08:30 JST
    expect(upcomingMonths(new Date('2026-11-30T23:30:00Z'), 3)).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ])
  })
})
