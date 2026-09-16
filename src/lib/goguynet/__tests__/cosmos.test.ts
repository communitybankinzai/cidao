import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  dedupeCandidates,
  eventTitleFromArticle,
  extractCandidates,
  normalizeJaTime,
  toCandidateDescription,
  type GoguynetPost,
} from '../cosmos'
import { candidateToRow, syncGoguynetCosmos, type CosmosExistingRow, type CosmosSyncDb } from '../sync'
import type { EventRow, OtherEventRow } from '@/lib/inzai-bunka/sync'

const posts = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/posts-cosmos-2026-09-16.json', import.meta.url)), 'utf-8'),
) as GoguynetPost[]
const byId = (id: number) => posts.find((p) => p.id === id)!
const BOT = '00000000-0000-0000-0000-000000000bot'

describe('extractCandidates（号外NET 実記事12件）', () => {
  it('定型ブロックあり：ランタンフェスティバル', () => {
    const [c] = extractCandidates(byId(50494))
    expect(c).toMatchObject({
      title: 'コスモスパレット・ランタンフェスティバル',
      date: '2026-09-13',
      startAt: '2026-09-13T14:00',
      endAt: '2026-09-13T19:30',
      timeAssumed: false,
      venue: 'コスモスパレットⅡ、花の丘公園Aゾーン',
      fee: 0,
      sourceId: 'goguynet:50494:2026-09-13',
      articleUrl: 'https://kamagaya-shiroi-inzai.goguynet.jp/2026/09/10/post-50494/',
    })
    expect(c.infoLines).toEqual(['日程：2026年9月13日（日）', '時間：14:00～19:30', '会場：コスモスパレットⅡ、花の丘公園Aゾーン', '入場料：無料'])
  })

  it('■日時に日付と時間が同居：2025 夏祭り', () => {
    const [c] = extractCandidates(byId(47307))
    expect(c).toMatchObject({ date: '2025-08-09', startAt: '2025-08-09T15:00', endAt: '2025-08-09T20:00', venue: 'コスモスパレットⅡ芸術ホール、花の丘公園Aゾーン' })
  })

  it('ブロック無し・本文の「開催時間は15:00～20:00」：2026 夏祭り', () => {
    const [c] = extractCandidates(byId(50184))
    expect(c.title).toBe('Cosmos Palette 夏祭り 2026')
    expect(c.date).toBe('2026-07-25')
    expect(c.startAt).toBe('2026-07-25T15:00')
    expect(c.endAt).toBe('2026-07-25T20:00')
  })

  it('ブロック無し・題名の日付のみ：マルシェ（時間は仮置き）', () => {
    const [c] = extractCandidates(byId(47872))
    expect(c).toMatchObject({ title: 'コスモスパレットマルシェ', date: '2025-10-12', timeAssumed: true, venue: 'コスモスパレット' })
  })

  it('「■開催日時：」の値が次の行以降（予選①②・決勝）：カラオケ大会は3日分', () => {
    const cs = extractCandidates(byId(50251))
    expect(cs.map((c) => c.date)).toEqual(['2026-10-12', '2026-11-14', '2026-12-13'])
    expect(cs[0].venue).toBe('コスモスパレットII 芸術ホール')
    expect(cs[2].startAt).toBe('2026-12-13T13:00')
    expect(cs[2].infoLines[0]).toContain('決勝')
  })

  it('コスモスパレット以外の記事は候補にしない（図書館休館・鎌ケ谷・文化ホール・防災マッチ・イルミライ）', () => {
    for (const id of [50447, 50420, 47486, 47003, 48483]) {
      expect(extractCandidates(byId(id))).toEqual([])
    }
  })

  it('同じ催しを先行予約記事と開催直前記事が告知していたら新しい記事だけ残す', () => {
    const all = posts.flatMap((p) => extractCandidates(p))
    const lantern = all.filter((c) => c.date === '2026-09-13')
    expect(lantern.length).toBe(2) // 50494 と 50208
    const kept = dedupeCandidates(all).filter((c) => c.date === '2026-09-13')
    expect(kept.length).toBe(1)
    expect(kept[0].postId).toBe(50494)
  })

  it('説明文は定型行と記事URLだけ（本文は転記しない）', () => {
    const [c] = extractCandidates(byId(50494))
    const d = toCandidateDescription(c)
    expect(d).toContain('■時間：14:00～19:30')
    expect(d).toContain('https://kamagaya-shiroi-inzai.goguynet.jp/2026/09/10/post-50494/')
    expect(d).not.toContain('300基のランタン')
  })
})

describe('小物', () => {
  it('eventTitleFromArticle', () => {
    expect(eventTitleFromArticle('【印西市】10月12日（日）「コスモスパレットマルシェ」開催！ こだわりの食べ物')).toBe('コスモスパレットマルシェ')
    expect(eventTitleFromArticle('【印西市】12月13日が決勝の「CosmosPalette カラオケ大会」の出場者募集中です！')).toBe('CosmosPalette カラオケ大会')
    expect(eventTitleFromArticle('【印西市】7月25日（土）コスモスパレット夏祭り開催！ 盛りだくさん')).toBe('コスモスパレット夏祭り')
  })
  it('normalizeJaTime', () => {
    expect(normalizeJaTime('15時～20時')).toBe('15:00～20:00')
    expect(normalizeJaTime('14時30分開場')).toBe('14:30開場')
    expect(normalizeJaTime('10時半')).toBe('10:30')
  })
  it('12月の記事が1月の催しを告知したら翌年', () => {
    const p: GoguynetPost = {
      id: 1, date: '2025-12-20T10:00:00', link: 'https://example.invalid/a',
      title: { rendered: '【印西市】1月10日（土）「コスモスパレット新春マルシェ」開催！' },
      content: { rendered: '<p>■日程：1月10日（土）</p><p>■会場：コスモスパレットⅡ</p>' },
    }
    expect(extractCandidates(p)[0].date).toBe('2026-01-10')
  })
  it('2日間の催しは日ごと、長い期間は候補にしない', () => {
    const mk = (dateLine: string): GoguynetPost => ({
      id: 2, date: '2026-09-01T10:00:00', link: 'https://example.invalid/b',
      title: { rendered: '【印西市】「コスモスパレット秋まつり」開催！' },
      content: { rendered: `<p>■日程：${dateLine}</p>` },
    })
    expect(extractCandidates(mk('2026年10月3日（土）～10月4日（日）')).map((c) => c.date)).toEqual(['2026-10-03', '2026-10-04'])
    expect(extractCandidates(mk('2026年10月1日（木）～2027年3月31日（水）'))).toEqual([])
  })
})

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
// 号外NET の URL にだけ固定記事を返し、他の媒体（ちいき新聞）は0件
const fetchPosts = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const body = url.startsWith('https://kamagaya-shiroi-inzai.goguynet.jp/') ? posts : []
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}) as unknown as typeof fetch
const NOW = new Date('2026-09-01T03:00:00Z') // 2026-09-01 JST（ランタンフェス・カラオケ決勝が未来）

describe('syncGoguynetCosmos', () => {
  it('今日以降の候補を draft で insert し、記事本文は入れない', async () => {
    const { db, inserted } = fakeDb()
    const r = await syncGoguynetCosmos(db, { botMemberId: BOT, fetchFn: fetchPosts, now: NOW })
    expect(r.ok).toBe(true)
    expect(r.fetched.list).toBe(12)
    const ids = inserted.map((x) => x.external_source_id)
    expect(ids).toContain('goguynet:50494:2026-09-13')
    expect(ids).toContain('goguynet:50251:2026-12-13')
    expect(ids).not.toContain('goguynet:50208:2026-09-13') // 先行予約記事は開催直前記事に吸収
    for (const row of inserted) {
      expect(row.status).toBe('draft')
      expect(row.proxy_registration).toBe(true)
      expect(row.external_source).toBe('goguynet-cosmos')
      expect(row.flyer_image_url).toBeNull()
    }
  })

  it('公開済み／見送りは触らず、draft は記事の変更だけ反映', async () => {
    const first = fakeDb()
    await syncGoguynetCosmos(first.db, { botMemberId: BOT, fetchFn: fetchPosts, now: NOW })
    const existing: CosmosExistingRow[] = first.inserted.map((row, i) => ({
      id: `id-${i}`, external_source_id: row.external_source_id, status: 'draft',
      title: row.title, description: row.description, start_at: row.start_at, end_at: row.end_at, location: row.location, fee: row.fee,
    }))
    const lantern = existing.find((e) => e.external_source_id === 'goguynet:50494:2026-09-13')!
    lantern.status = 'open'
    lantern.start_at = '2026-09-13T00:00:00+00:00' // 公開後に運営が時間を直した想定
    const karaoke = existing.find((e) => e.external_source_id === 'goguynet:50251:2026-12-13')!
    karaoke.fee = 500 // 記事と食い違う draft
    const second = fakeDb(existing)
    const r = await syncGoguynetCosmos(second.db, { botMemberId: BOT, fetchFn: fetchPosts, now: NOW })
    expect(second.inserted).toHaveLength(0)
    expect(second.updated.map((u) => u.id)).toEqual([karaoke.id])
    expect(second.updated[0].patch).toEqual({ fee: 0 })
    expect(r.unchanged).toBe(existing.length - 1)
  })

  it('他の経路で同日・コスモスパレット・似た題名が登録済みなら insert しない', async () => {
    const others: OtherEventRow[] = [
      { id: 'm1', title: 'コスモスパレット ランタンフェスティバル', start_at: '2026-09-13T05:00:00+00:00', location: 'コスモスパレットⅡ', organizer_name_text: null },
    ]
    const { db, inserted } = fakeDb([], others)
    const r = await syncGoguynetCosmos(db, { botMemberId: BOT, fetchFn: fetchPosts, now: NOW })
    expect(inserted.map((x) => x.external_source_id)).not.toContain('goguynet:50494:2026-09-13')
    expect(r.duplicates[0]).toContain('(m1)')
  })

  it('candidateToRow は必須列を満たす', () => {
    const [c] = extractCandidates(byId(50494))
    const row = candidateToRow(c, BOT)
    expect(row.start_at).toBe('2026-09-13T05:00:00.000Z')
    expect(row.category).toBe('machizukuri')
    expect(row.location).toBe('コスモスパレットⅡ、花の丘公園Aゾーン')
  })
})
