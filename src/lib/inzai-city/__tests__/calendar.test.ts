import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildCityCalendarUrl,
  cityItemToCandidates,
  cityKindToCategory,
  parseCityCalendarHtml,
  parseCityDetailHtml,
  parseWarekiDates,
  toCityDescription,
} from '../calendar'
import { cityCandidateToRow, syncInzaiCity } from '../sync'
import type { CosmosExistingRow, CosmosSyncDb } from '@/lib/goguynet/sync'
import type { EventRow, OtherEventRow } from '@/lib/inzai-bunka/sync'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8')
const BOT = '00000000-0000-0000-0000-000000000bot'

describe('parseCityCalendarHtml（市サイト 2026-09／10 の実HTML）', () => {
  it('9月：複数日の催しは1項目に日付をまとめる', () => {
    const items = parseCityCalendarHtml(fixture('calendar-2026-09.html'), 2026, 9)
    const climb = items.find((i) => i.pageId === '0000020551')!
    expect(climb.title).toContain('クライミング教室')
    expect(climb.dates).toEqual(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'])
    expect(climb.kind).toBe('スポーツ')
    expect(climb.url).toBe('https://www.city.inzai.lg.jp/0000020551.html')
    expect(items.some((i) => i.pageId === '0000022377')).toBe(true)
  })
  it('10月：同じページへの複数リンクは1項目にまとまる', () => {
    const items = parseCityCalendarHtml(fixture('calendar-2026-10.html'), 2026, 10)
    expect(items.length).toBeGreaterThanOrEqual(8)
    expect(new Set(items.map((i) => i.url)).size).toBe(items.length)
    const kids = items.find((i) => i.pageId === '0000021544')!
    expect(kids.dates).toEqual(['2026-10-04'])
    expect(kids.kind).toBe('講座・催し')
  })
  it('表が無ければ空', () => {
    expect(parseCityCalendarHtml('<html>ページが見つかりません</html>', 2026, 12)).toEqual([])
  })
})

describe('parseWarekiDates', () => {
  it('和暦と西暦', () => {
    expect(parseWarekiDates('令和8年9月27日（日曜日）14時から16時')).toEqual(['2026-09-27'])
    expect(parseWarekiDates('2026年10月6日(火) ･ 11月10日')).toEqual(['2026-10-06'])
    expect(parseWarekiDates('令和８年１０月３日')).toEqual(['2026-10-03'])
  })
})

describe('parseCityDetailHtml', () => {
  it('見出し型（資料館講座）：日時・場所・定員・申し込み・担当課', () => {
    const d = parseCityDetailHtml(fixture('detail-0000022377.html'))
    expect(d.title).toContain('資料館講座')
    expect(d.postedAt).toBe('2026-08-19')
    expect(d.dateText).toContain('令和8年9月27日')
    expect(d.dateText).toContain('14時から16時')
    expect(d.venue).toContain('印旛歴史民俗資料館')
    expect(d.capacityText).toBe('20人')
    expect(d.applyText).toContain('8月19日')
    expect(d.department).toContain('文化振興課')
  })
  it('◆ラベル型（海外派遣報告会）：日にち・時間・会場', () => {
    const d = parseCityDetailHtml(fixture('detail-0000021544.html'))
    expect(d.dateText).toContain('令和8年10月4日')
    expect(d.timeText).toContain('10時から11時20分')
    expect(d.venue).toContain('コスモスパレット')
  })
  it('おさがりマルシェ：開催日・開催場所の見出し', () => {
    const d = parseCityDetailHtml(fixture('detail-0000015962.html'))
    expect(d.dateText).toContain('10月3日')
    expect(d.venue.length).toBeGreaterThan(0)
  })
  it('本文が無ければ全部空', () => {
    const d = parseCityDetailHtml('<html><h1>x</h1></html>')
    expect(d.dateText).toBe('')
    expect(d.venue).toBe('')
  })
})

describe('cityItemToCandidates', () => {
  const items9 = parseCityCalendarHtml(fixture('calendar-2026-09.html'), 2026, 9)
  const items10 = parseCityCalendarHtml(fixture('calendar-2026-10.html'), 2026, 10)

  it('資料館講座：カレンダーの日付＋詳細の時間', () => {
    const it = items9.find((i) => i.pageId === '0000022377')!
    const [c] = cityItemToCandidates(it, parseCityDetailHtml(fixture('detail-0000022377.html')))
    expect(c).toMatchObject({
      date: '2026-09-27',
      startAt: '2026-09-27T14:00',
      endAt: '2026-09-27T16:00',
      timeAssumed: false,
      sourceId: 'city:0000022377:2026-09-27',
      venue: '印西市立印旛歴史民俗資料館 学習室（印西市岩戸1742）',
      fee: null,
    })
    expect(c.title).toBe('資料館講座 ふるさと印西の成り立ち') // 「（令和8年9月27日開催）」は落とす
    expect(c.organizer).toContain('文化振興課')
    const d = toCityDescription(c)
    expect(d).toContain('■定員：20人')
    expect(d).toContain('https://www.city.inzai.lg.jp/0000022377.html')
  })
  it('海外派遣報告会：「10時から11時20分頃まで」', () => {
    const it = items10.find((i) => i.pageId === '0000021544')!
    const [c] = cityItemToCandidates(it, parseCityDetailHtml(fixture('detail-0000021544.html')))
    expect(c.startAt).toBe('2026-10-04T10:00')
    expect(c.endAt).toBe('2026-10-04T12:00')
    expect(c.venue).toContain('芸術ホール')
  })
  it('複数日の教室は日ごと、詳細が無ければ時間は仮置き', () => {
    const it = items9.find((i) => i.pageId === '0000020551')!
    const cs = cityItemToCandidates(it, null)
    expect(cs.map((c) => c.date)).toEqual(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'])
    expect(cs[0].timeAssumed).toBe(true)
    expect(cs[0].title).toBe('クライミング教室の開催について')
  })
  it('6日以上連続する催しは初日の1件にまとめる', () => {
    const cs = cityItemToCandidates(
      { pageId: '1', url: 'https://www.city.inzai.lg.jp/1.html', title: 'イルミライ★INZAI', kind: '講座・催し', dates: Array.from({ length: 17 }, (_, i) => `2026-11-${String(14 + i).padStart(2, '0')}`) },
      null,
    )
    expect(cs).toHaveLength(1)
    expect(cs[0].title).toBe('イルミライ★INZAI（〜11/30）')
    expect(cs[0].periodEnd).toBe('2026-11-30')
  })
  it('cityKindToCategory', () => {
    expect(cityKindToCategory('スポーツ')).toBe('bunka')
    expect(cityKindToCategory('講座・催し')).toBe('other')
  })
})

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const ok = (html: string) => new Response(html, { status: 200 })
    if (url === buildCityCalendarUrl(2026, 9)) return ok(fixture('calendar-2026-09.html'))
    if (url === buildCityCalendarUrl(2026, 10)) return ok(fixture('calendar-2026-10.html'))
    if (url.includes('/event2/')) return new Response('not found', { status: 404 })
    for (const id of ['0000022377', '0000021544', '0000015962']) if (url.endsWith(`/${id}.html`)) return ok(fixture(`detail-${id}.html`))
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}
function fakeDb(existing: CosmosExistingRow[] = [], others: OtherEventRow[] = []) {
  const inserted: EventRow[] = []
  const updated: { id: string; patch: Partial<EventRow> }[] = []
  const db: CosmosSyncDb = {
    listExisting: async () => existing,
    listOtherFutureEvents: async () => others,
    insert: async (row) => { inserted.push(row) },
    update: async (id, patch) => { updated.push({ id, patch }) },
  }
  return { db, inserted, updated }
}
const NOW = new Date('2026-09-15T03:00:00Z')

describe('syncInzaiCity', () => {
  it('今日以降を draft で insert。404 の月は飛ばし、詳細が取れないページも登録する', async () => {
    const { db, inserted } = fakeDb()
    const r = await syncInzaiCity(db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW })
    expect(r.ok).toBe(true)
    expect(r.skipped.some((s) => s.startsWith('カレンダー 2026-11'))).toBe(true)
    expect(r.fetched.details).toBe(3)
    expect(r.fetched.detailFailed).toBeGreaterThan(0)
    const ids = inserted.map((x) => x.external_source_id)
    expect(ids).toContain('city:0000022377:2026-09-27')
    expect(ids).toContain('city:0000021544:2026-10-04')
    expect(ids).toContain('city:0000020551:2026-09-19')
    expect(ids).not.toContain('city:0000020551:2026-09-05') // 過去
    for (const row of inserted) {
      expect(row.status).toBe('draft')
      expect(row.external_source).toBe('inzai-city-calendar')
    }
  })
  it('広報いんざいから登録済み（同日・似た題名）は insert しない', async () => {
    const others: OtherEventRow[] = [
      { id: 'k1', title: 'こども服リユース事業「おさがりマルシェ」', start_at: '2026-10-03T01:00:00+00:00', location: '市役所本庁', organizer_name_text: null },
    ]
    const { db, inserted } = fakeDb([], others)
    const r = await syncInzaiCity(db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW })
    expect(inserted.map((x) => x.external_source_id)).not.toContain('city:0000015962:2026-10-03')
    expect(r.duplicates.some((d) => d.includes('(k1)'))).toBe(true)
  })
  it('cityCandidateToRow の必須列', () => {
    const it = parseCityCalendarHtml(fixture('calendar-2026-09.html'), 2026, 9).find((i) => i.pageId === '0000022377')!
    const [c] = cityItemToCandidates(it, parseCityDetailHtml(fixture('detail-0000022377.html')))
    const row = cityCandidateToRow(c, BOT)
    expect(row.start_at).toBe('2026-09-27T05:00:00.000Z')
    expect(row.proxy_source_url).toBe('https://www.city.inzai.lg.jp/0000022377.html')
    expect(row.organizer_name_text).toContain('印西市')
  })
})
