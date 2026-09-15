import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCalendarHtml, toEventDescription } from '../calendar'
import {
  entryFingerprint,
  listItemToEntries,
  mergeEntries,
  parseDateText,
  parseEventDetailHtml,
  parseEventListHtml,
  timeTextForDate,
} from '../events'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8')

describe('parseDateText', () => {
  it('単日', () => {
    expect(parseDateText('2026年9月18日(金)')).toEqual({ dates: ['2026-09-18'], isRange: false })
  })
  it('複数日（年は引き継ぎ、月が戻ったら翌年）', () => {
    expect(parseDateText('2026年10月6日(火), 11月10日(火), 11月20日(金), 12月10日(木)').dates).toEqual([
      '2026-10-06', '2026-11-10', '2026-11-20', '2026-12-10',
    ])
    expect(parseDateText('2026年12月20日(日), 1月10日(日)').dates).toEqual(['2026-12-20', '2027-01-10'])
  })
  it('期間表記は isRange', () => {
    const r = parseDateText('2026年10月1日(木) 〜 2027年3月31日(水)')
    expect(r.isRange).toBe(true)
    expect(r.dates).toEqual(['2026-10-01', '2027-03-31'])
  })
})

describe('parseEventListHtml（2026-09-15 の公演一覧）', () => {
  const items = parseEventListHtml(fixture('event-list.html'))

  it('全件拾い、投稿IDと絶対URLの画像を持つ', () => {
    expect(items.length).toBe(16)
    const fn = items.find((i) => i.postId === '38056')
    expect(fn).toMatchObject({
      url: 'https://www.inzai-bunka.jp/event/38056/',
      title: 'フライデーナイトコンサートVol.15',
      dates: ['2026-09-18'],
      isRange: false,
      isSyusai: true,
      imageUrl: 'https://www.inzai-bunka.jp/src/2026/06/2605_inzai_FridayNight_vol15_A4_12.jpg',
    })
    expect(fn?.timeText).toContain('開演 19:30')
  })

  it('<br> 入りの題名は1行にする', () => {
    const t = items.find((i) => i.postId === '38278')
    expect(t?.title).toBe('原口あきまさ×キンタロー。with ねんねん ものまねLIVE')
  })

  it('複数日程の講座は4日分の日付を持つ', () => {
    const t = items.find((i) => i.postId === '38704')
    expect(t?.dates).toEqual(['2026-10-06', '2026-11-10', '2026-11-20', '2026-12-10'])
  })

  it('募集案内（期間表記）は isRange', () => {
    const r = items.filter((i) => i.isRange)
    expect(r.map((i) => i.postId).sort()).toEqual(['38199', '38213'])
  })
})

describe('parseEventDetailHtml', () => {
  it('多目的室の主催公演（定員・対象・申込あり）', () => {
    const d = parseEventDetailHtml(fixture('event-detail-38586.html'))
    expect(d.venue).toBe('多目的室')
    expect(d.feeText).toBe('参加無料(要事前申し込み)')
    expect(d.organizer).toContain('印西市文化ホール')
    expect(d.contact).toContain('0476-42-8811')
    expect(d.capacityText).toBe('15名程度(先着順)')
    expect(d.targetText).toContain('小・中学生')
    expect(d.applyText).toContain('formzu')
    expect(d.imageUrl).toBe('https://www.inzai-bunka.jp/src/2026/08/inzai_bunkahall_fall.jpg')
  })
  it('大会議室の講座（「申込」表記）', () => {
    const d = parseEventDetailHtml(fixture('event-detail-38704.html'))
    expect(d.venue).toBe('2階 大会議室')
    expect(d.feeText).toBe('各回2,500円(材料費込み)')
    expect(d.applyText).toContain('9月13日')
  })
  it('構造が無ければ全項目が空', () => {
    const d = parseEventDetailHtml('<html></html>')
    expect(d).toEqual({ venue: '', feeText: '', organizer: '', contact: '', capacityText: '', targetText: '', applyText: '', imageUrl: null })
  })
})

describe('timeTextForDate', () => {
  const t = '①フラワーアレンジメント講座 10/6(火) 13:00～15:00 (予定)\n②裂き織り講座 11/10(火) ①10:00～12:30 ②13:30～16:00 (予定)\n③レザークラフト講座 11/20(金) 10:00～12:00 (予定)'
  it('その日の行だけを返す', () => {
    expect(timeTextForDate(t, '2026-11-10')).toBe('②裂き織り講座 11/10(火) ①10:00～12:30 ②13:30～16:00 (予定)')
    expect(timeTextForDate(t, '2026-11-20')).toBe('③レザークラフト講座 11/20(金) 10:00～12:00 (予定)')
  })
  it('該当行が無ければ全文', () => {
    expect(timeTextForDate(t, '2026-12-10')).toBe(t)
  })
})

describe('listItemToEntries + mergeEntries', () => {
  const items = parseEventListHtml(fixture('event-list.html'))
  const detail38704 = parseEventDetailHtml(fixture('event-detail-38704.html'))

  it('複数日程は日ごとに1件、時間はその日の行から', () => {
    const item = items.find((i) => i.postId === '38704')!
    const es = listItemToEntries(item, detail38704)
    expect(es.map((e) => e.sourceId)).toEqual([
      'post:38704:2026-10-06', 'post:38704:2026-11-10', 'post:38704:2026-11-20', 'post:38704:2026-12-10',
    ])
    expect(es[0]).toMatchObject({ startAt: '2026-10-06T13:00', endAt: '2026-10-06T15:00', venue: '2階 大会議室', fee: 2500 })
    expect(es[1]).toMatchObject({ startAt: '2026-11-10T10:00', endAt: '2026-11-10T16:00' })
    expect(es[2]).toMatchObject({ startAt: '2026-11-20T10:00', endAt: '2026-11-20T12:00' })
    const desc = toEventDescription(es[0], 'https://example.invalid/')
    expect(desc).toContain('【申込】')
    expect(desc).toContain('https://www.inzai-bunka.jp/event/38704/')
  })

  it('募集案内は登録しない', () => {
    const r = items.find((i) => i.postId === '38213')!
    expect(listItemToEntries(r, null)).toEqual([])
  })

  it('詳細が取れなくても一覧の情報だけで登録できる', () => {
    const item = items.find((i) => i.postId === '38056')!
    const [e] = listItemToEntries(item, null)
    expect(e).toMatchObject({ startAt: '2026-09-18T19:30', venue: '', fee: null, imageUrl: item.imageUrl })
  })

  it('一覧由来を優先し、カレンダーの同一公演は落とし、貸館公演は残す', () => {
    const cal = parseCalendarHtml(fixture('calendar-2026-09.html'), 2026, 9)
    const fromList = items.flatMap((i) => listItemToEntries(i, null))
    const merged = mergeEntries(fromList, cal)
    const ids = merged.map((e) => e.sourceId)
    expect(ids.filter((id) => id === 'post:38056:2026-09-18').length).toBe(1)
    expect(ids.some((id) => id.startsWith('cal:2026-09-12:'))).toBe(true) // ピアノ発表会（貸館）
    // 一覧由来が勝つ（画像URLを持つ）
    expect(merged.find((e) => e.sourceId === 'post:38056:2026-09-18')?.imageUrl).toBeTruthy()
    // 開始日時順
    const starts = merged.map((e) => e.startAt)
    expect([...starts].sort()).toEqual(starts)
  })

  it('fingerprint は内容が同じなら同じ、時刻が変われば変わる', () => {
    const item = items.find((i) => i.postId === '38056')!
    const [a] = listItemToEntries(item, null)
    const [b] = listItemToEntries(item, null)
    expect(entryFingerprint(a)).toBe(entryFingerprint(b))
    expect(entryFingerprint({ ...a, startAt: '2026-09-18T20:00' })).not.toBe(entryFingerprint(a))
  })
})
