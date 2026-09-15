import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { INZAI_BUNKA_SOURCE, buildCalendarUrl } from '../calendar'
import { INZAI_BUNKA_EVENT_LIST_URL } from '../events'
import {
  diffRow,
  entryToRow,
  isSimilarTitle,
  parseCapacity,
  syncInzaiBunka,
  todayJst,
  type EventRow,
  type ExistingEventRow,
  type OtherEventRow,
  type SyncDb,
} from '../sync'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8')

const BOT = '00000000-0000-0000-0000-000000000bot'

/** 固定HTMLだけを返す偽 fetch。詳細は 38586/38704 以外は 404 にして「詳細が取れない」経路も通す */
function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = (html: string) => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    if (url === INZAI_BUNKA_EVENT_LIST_URL) return body(fixture('event-list.html'))
    if (url === buildCalendarUrl(2026, 9)) return body(fixture('calendar-2026-09.html'))
    if (url === buildCalendarUrl(2026, 10)) return body(fixture('calendar-2026-10.html'))
    if (url.startsWith('https://www.inzai-bunka.jp/event_calendar/')) return body('<html></html>')
    if (url.endsWith('/event/38586/')) return body(fixture('event-detail-38586.html'))
    if (url.endsWith('/event/38704/')) return body(fixture('event-detail-38704.html'))
    if (url.includes('/src/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

function fakeDb(existing: ExistingEventRow[] = [], others: OtherEventRow[] = []) {
  const inserted: EventRow[] = []
  const updated: { id: string; patch: Partial<EventRow> }[] = []
  const uploaded: string[] = []
  const db: SyncDb = {
    listExisting: async () => existing,
    listOtherFutureEvents: async () => others,
    insert: async (row) => { inserted.push(row) },
    update: async (id, patch) => { updated.push({ id, patch }) },
    uploadFlyer: async (path) => { uploaded.push(path); return `https://storage.example/${path}` },
  }
  return { db, inserted, updated, uploaded }
}

const NOW = new Date('2026-09-15T03:00:00Z') // 2026-09-15 12:00 JST

describe('syncInzaiBunka（固定HTML・偽DB）', () => {
  it('今日以降を insert し、募集案内は skip、詳細が取れなくても一覧の情報で登録する', async () => {
    const { db, inserted, uploaded } = fakeDb()
    const r = await syncInzaiBunka(db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW })
    expect(r.ok).toBe(true)
    expect(r.fetched.list).toBe(16)
    expect(r.fetched.details).toBe(2)
    expect(r.fetched.detailFailed).toBe(12)
    // 一覧の期間表記2件＋カレンダーだけに載る「出場者募集」1件
    expect(r.skipped.filter((s) => s.startsWith('募集案内'))).toHaveLength(3)
    expect(inserted.some((x) => x.title.includes('出場者募集'))).toBe(false)
    // 2026-09-12/13 の貸館公演は過去なので入らない
    expect(inserted.some((x) => x.external_source_id.startsWith('cal:2026-09-12:'))).toBe(false)
    expect(r.inserted.length).toBe(inserted.length)
    expect(inserted.length).toBe(18) // 21件 − 過去2件 − 募集案内1件
    const kids = inserted.find((x) => x.external_source_id === 'post:38586:2026-10-04')!
    expect(kids).toMatchObject({
      category: 'bunka',
      location: '印西市文化ホール 多目的室',
      capacity: 15,
      fee: 0,
      organizer_type: 'member',
      organizer_id: BOT,
      proxy_registration: true,
      proxy_source_url: 'https://www.inzai-bunka.jp/event/38586/',
      external_source: INZAI_BUNKA_SOURCE,
      status: 'open',
      flyer_image_url: 'https://storage.example/inzai-bunka/38586.jpg',
    })
    expect(kids.start_at).toBe('2026-10-04T01:30:00.000Z') // 10:30 JST
    // 貸館公演（9/23 熊本地震義援金演奏会）は出典がカレンダーURL・画像なし
    const rental = inserted.find((x) => x.external_source_id.startsWith('cal:2026-09-23:'))!
    expect(rental.proxy_source_url).toBe(buildCalendarUrl(2026, 9))
    expect(rental.organizer_name_text).toBe('印西音楽協会')
    expect(rental.flyer_image_url).toBeNull()
    // 4日程の講座は画像を1回だけ取りに行く
    expect(uploaded.filter((p) => p === 'inzai-bunka/38704.jpg')).toHaveLength(1)
    expect(inserted.filter((x) => x.external_source_id.startsWith('post:38704:'))).toHaveLength(4)
  })

  it('2回目は unchanged、内容が変わった行だけ update する', async () => {
    const first = fakeDb()
    await syncInzaiBunka(first.db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW })
    const existing: ExistingEventRow[] = first.inserted.map((row, i) => ({
      id: `id-${i}`,
      external_source_id: row.external_source_id,
      title: row.title,
      description: row.description,
      start_at: row.start_at.replace('.000Z', '+00:00'), // Postgres の返し方でも同一時刻と判定
      end_at: row.end_at,
      location: row.location,
      fee: row.fee,
      capacity: row.capacity,
      organizer_name_text: row.organizer_name_text,
      proxy_source_url: row.proxy_source_url,
      flyer_image_url: row.flyer_image_url,
    }))
    // 1件だけ文化ホール側が時間を変えたことにする
    const victim = existing.find((e) => e.external_source_id === 'post:38586:2026-10-04')!
    victim.start_at = '2026-10-04T00:00:00+00:00'
    const second = fakeDb(existing)
    const r = await syncInzaiBunka(second.db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW })
    expect(r.ok).toBe(true)
    expect(second.inserted).toHaveLength(0)
    expect(second.updated).toHaveLength(1)
    expect(second.updated[0]).toMatchObject({ id: victim.id, patch: { start_at: '2026-10-04T01:30:00.000Z' } })
    expect(r.unchanged).toBe(existing.length - 1)
    // 既存行の画像を再利用するので再アップロードしない
    expect(second.uploaded).toHaveLength(0)
  })

  it('同じ日に文化ホールで似た題名の手動登録があれば insert せず duplicates に載せる', async () => {
    const others: OtherEventRow[] = [
      // 手動登録（副題つき・表記ゆれ）
      { id: 'm1', title: 'フライデーナイトコンサート Vol.15 『星の王子さま』朗読とフランス室内楽', start_at: '2026-09-18T10:30:00+00:00', location: '印西市文化ホール', organizer_name_text: null },
      { id: 'm2', title: '原口あきまさ×キンタロー。ものまねLIVE with ねんねん', start_at: '2026-10-12T05:00:00+00:00', location: '印西市文化ホール', organizer_name_text: null },
      { id: 'm3', title: 'いんざい手仕事工房 手仕事を楽しむ4つの講座', start_at: '2026-10-06T04:00:00+00:00', location: '印西市文化ホール 2階 大会議室', organizer_name_text: null },
      // 同じ日でも文化ホール以外なら別物
      { id: 'm4', title: '文化ホール探検隊 秋の巻', start_at: '2026-09-27T04:00:00+00:00', location: '中央公民館', organizer_name_text: null },
      // 別の日なら別物
      { id: 'm5', title: 'いんざい手仕事工房 手仕事を楽しむ4つの講座', start_at: '2026-11-11T04:00:00+00:00', location: '印西市文化ホール', organizer_name_text: null },
    ]
    const { db, inserted } = fakeDb([], others)
    const r = await syncInzaiBunka(db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW })
    const ids = inserted.map((x) => x.external_source_id)
    expect(ids).not.toContain('post:38056:2026-09-18')
    expect(ids).not.toContain('post:38278:2026-10-12')
    expect(ids).not.toContain('post:38704:2026-10-06')
    expect(ids).toContain('post:38584:2026-09-27') // 会場違い
    expect(ids).toContain('post:38704:2026-11-10') // 日違い
    expect(r.duplicates).toHaveLength(3)
    expect(r.duplicates[0]).toContain('(m1)')
  })

  it('dry=1 は DB に書かない', async () => {
    const { db, inserted, updated, uploaded } = fakeDb()
    const r = await syncInzaiBunka(db, { botMemberId: BOT, fetchFn: fakeFetch(), now: NOW, dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.inserted.length).toBeGreaterThan(0)
    expect(inserted).toHaveLength(0)
    expect(updated).toHaveLength(0)
    expect(uploaded).toHaveLength(0)
  })

  it('一覧が0件なら何も書かずに失敗を返す', async () => {
    const { db, inserted } = fakeDb()
    const f = (async () => new Response('<html>maintenance</html>', { status: 200 })) as unknown as typeof fetch
    const r = await syncInzaiBunka(db, { botMemberId: BOT, fetchFn: f, now: NOW })
    expect(r.ok).toBe(false)
    expect(inserted).toHaveLength(0)
  })
})

describe('小物', () => {
  it('isSimilarTitle', () => {
    expect(isSimilarTitle('フライデーナイトコンサートVol.15', 'フライデーナイトコンサート Vol.15 『星の王子さま』朗読とフランス室内楽')).toBe(true)
    expect(isSimilarTitle('原口あきまさ×キンタロー。with ねんねん ものまねLIVE', '原口あきまさ×キンタロー。ものまねLIVE with ねんねん')).toBe(true)
    expect(isSimilarTitle('第15回みんなで一緒に！ファミリーコンサート', '第15回 みんなで一緒に！ファミリーコンサート ベビーのための音楽会')).toBe(true)
    expect(isSimilarTitle('第8回クラシック・ガラいんざい', '第8回 クラシック・ガラいんざい オペラ「ヘンゼルとグレーテル」')).toBe(true)
    expect(isSimilarTitle('バイリンガル・スピーチコンテスト in 印西 2026', 'バイリンガルスピーチコンテスト in 印西 出場者募集')).toBe(true)
    expect(isSimilarTitle('フライデーナイトコンサートVol.15', '印西ウインドアンサンブル オータム・コンサート2026')).toBe(false)
    expect(isSimilarTitle('お気楽寄席（１月）', '第9回 印西国際音楽コンクール')).toBe(false)
  })
  it('parseCapacity', () => {
    expect(parseCapacity('15名程度(先着順)')).toBe(15)
    expect(parseCapacity('各回２０名')).toBe(20)
    expect(parseCapacity('')).toBeNull()
    expect(parseCapacity(undefined)).toBeNull()
  })
  it('todayJst は日本時間の日付', () => {
    expect(todayJst(new Date('2026-09-15T15:30:00Z'))).toBe('2026-09-16')
  })
  it('entryToRow は80字を超える題名を切る', () => {
    const row = entryToRow(
      {
        date: '2026-10-01', title: 'あ'.repeat(100), detailUrl: null, isSyusai: false, timeText: '', venue: '', feeText: '',
        organizer: '', contact: '', startAt: '2026-10-01T09:00', endAt: '2026-10-01T17:00', timeAssumed: true, fee: null,
        sourceId: 'cal:2026-10-01:abc',
      },
      BOT,
      null,
    )
    expect(row.title.length).toBe(80)
    expect(row.organizer_name_text).toBe('印西市文化ホール')
    expect(row.description).toContain('仮置き')
  })
  it('diffRow は変わった項目だけ返し、既存画像は差し替えない', () => {
    const row = entryToRow(
      {
        date: '2026-10-01', title: 'T', detailUrl: 'https://www.inzai-bunka.jp/event/1/', isSyusai: true, timeText: '開演 10:00',
        venue: 'ホール', feeText: '1,000円', organizer: 'X', contact: '', startAt: '2026-10-01T10:00', endAt: '2026-10-01T12:00',
        timeAssumed: false, fee: 1000, sourceId: 'post:1:2026-10-01',
      },
      BOT,
      'https://storage.example/new.jpg',
    )
    const ex: ExistingEventRow = {
      id: 'x', external_source_id: row.external_source_id, title: 'T', description: row.description,
      start_at: '2026-10-01T01:00:00+00:00', end_at: '2026-10-01T03:00:00+00:00', location: row.location,
      fee: 1000, capacity: null, organizer_name_text: 'X', proxy_source_url: row.proxy_source_url,
      flyer_image_url: 'https://storage.example/old.jpg',
    }
    expect(diffRow(ex, row)).toEqual({})
    expect(diffRow({ ...ex, fee: 500, flyer_image_url: null }, row)).toEqual({ fee: 1000, flyer_image_url: 'https://storage.example/new.jpg' })
  })
})
