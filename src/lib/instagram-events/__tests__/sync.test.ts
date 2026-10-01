import { describe, expect, it, vi } from 'vitest'
import {
  captionHint,
  fetchHashtagRecentMedia,
  hasDateMention,
  looksLikeEventPost,
  pickImageUrl,
  toIgMedia,
  type IgMedia,
} from '../hashtag'
import {
  candidateToRow,
  findDuplicateByDateTitle,
  occurrencesOf,
  syncInstagramEvents,
  toCandidateDescription,
  type IgSyncDb,
} from '../sync'
import type { FlyerExtract } from '@/lib/event-flyer-extract'
import type { EventRow, OtherEventRow } from '@/lib/inzai-bunka/sync'

const BOT = '00000000-0000-0000-0000-000000000bot'
// 1x1 の PNG（画像の判定と SHA-256 に使う。中身は何でもよい）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function media(over: Partial<IgMedia> & { id: string }): IgMedia {
  return {
    caption: '',
    media_type: 'IMAGE',
    media_url: `https://cdn.example/${over.id}.jpg`,
    permalink: `https://www.instagram.com/p/${over.id}/`,
    timestamp: '2026-10-01T01:00:00+0000',
    children: [],
    ...over,
  }
}

describe('一次ふるい（AI 不使用）', () => {
  it('日付の表記を見つける', () => {
    expect(hasDateMention('10/12（日）開催')).toBe(true)
    expect(hasDateMention('１０月１２日 マルシェ')).toBe(true)
    expect(hasDateMention('12日(土)に開催します')).toBe(true)
    expect(hasDateMention('本日オープン！')).toBe(false)
    expect(hasDateMention('2026年 秋')).toBe(false)
  })

  it('画像があり、本文に日付と催しの語がある投稿だけ通す', () => {
    expect(looksLikeEventPost(media({ id: 'a', caption: '10月12日 ハロウィンマルシェ開催 #印西' }))).toEqual({ ok: true })
    expect(looksLikeEventPost(media({ id: 'b', caption: '10月12日 新作入荷しました #印西' }))).toEqual({ ok: false, reason: 'not_event' })
    expect(looksLikeEventPost(media({ id: 'c', caption: 'マルシェ開催 #印西' }))).toEqual({ ok: false, reason: 'no_date' })
    expect(looksLikeEventPost(media({ id: 'd', caption: '10/12 のランチ #印西' }))).toEqual({ ok: false, reason: 'no_event_word' })
    expect(looksLikeEventPost(media({ id: 'e', caption: '10/12 講座', media_type: 'VIDEO' }))).toEqual({ ok: false, reason: 'no_image' })
  })

  it('カルーセルは最初の画像、動画は対象外', () => {
    expect(pickImageUrl(media({ id: 'a', media_type: 'CAROUSEL_ALBUM', media_url: 'https://cdn.example/album.jpg', children: [
      { id: '1', media_type: 'VIDEO', media_url: 'https://cdn.example/v.mp4' },
      { id: '2', media_type: 'IMAGE', media_url: 'https://cdn.example/2.jpg' },
    ] }))).toBe('https://cdn.example/2.jpg')
    expect(pickImageUrl(media({ id: 'b', media_type: 'CAROUSEL_ALBUM', media_url: 'https://cdn.example/album.jpg' }))).toBe('https://cdn.example/album.jpg')
    expect(pickImageUrl(media({ id: 'c', media_type: 'VIDEO', media_url: 'https://cdn.example/v.mp4' }))).toBeNull()
  })

  it('本文の参考情報は空白をまとめて 600 字で切る', () => {
    expect(captionHint('  a \n\n b  ')).toBe('a b')
    expect(captionHint('x'.repeat(700)).length).toBe(601)
  })

  it('Graph API の応答を整える（http は捨てる・children を展開）', () => {
    expect(toIgMedia({ id: '1', permalink: 'http://insecure/' })).toBeNull()
    const m = toIgMedia({ id: '1', permalink: 'https://www.instagram.com/p/1/', caption: null, media_type: 'CAROUSEL_ALBUM', children: { data: [{ id: 'c1', media_type: 'IMAGE', media_url: 'https://cdn/c1.jpg' }] } })
    expect(m).toMatchObject({ id: '1', caption: '', children: [{ id: 'c1', media_type: 'IMAGE', media_url: 'https://cdn/c1.jpg' }] })
  })
})

describe('fetchHashtagRecentMedia', () => {
  it('ハッシュタグ ID を引き、ページ送りして重複なく集める', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('ig_hashtag_search')) return new Response(JSON.stringify({ data: [{ id: 'H1' }] }), { status: 200 })
      if (url.includes('/H1/recent_media') && !url.includes('after=')) {
        return new Response(JSON.stringify({ data: [{ id: 'p1', permalink: 'https://www.instagram.com/p/p1/' }], paging: { next: 'https://graph.facebook.com/v22.0/H1/recent_media?after=X&access_token=t' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [{ id: 'p1', permalink: 'https://www.instagram.com/p/p1/' }, { id: 'p2', permalink: 'https://www.instagram.com/p/p2/' }] }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchHashtagRecentMedia(fetchFn, { userId: 'u', token: 't', hashtag: '印西' })
    expect(r.hashtagId).toBe('H1')
    expect(r.pages).toBe(2)
    expect(r.truncated).toBe(false)
    expect(r.media.map((m) => m.id)).toEqual(['p1', 'p2'])
    expect(calls[0]).toContain('q=%E5%8D%B0%E8%A5%BF')
    // children は要求しない（人気タグで 500 になるため）・10 件ずつ
    expect(calls[1]).toContain('limit=10')
    expect(calls[1]).not.toContain('children')
    // 締切を過ぎていれば 2 ページ目以降は取らない
    const r2 = await fetchHashtagRecentMedia(fetchFn, { userId: 'u', token: 't', hashtag: '印西', deadline: Date.now() - 1 })
    expect(r2.pages).toBe(1)
    expect(r2.truncated).toBe(true)
    expect(r2.media.map((m) => m.id)).toEqual(['p1'])
  })

  it('空のページが来たら next があっても終わり（24 時間分の後は空ページが続くため）', async () => {
    let n = 0
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('ig_hashtag_search')) return new Response(JSON.stringify({ data: [{ id: 'H1' }] }), { status: 200 })
      n++
      const next = `https://graph.facebook.com/v22.0/H1/recent_media?after=${n}&access_token=t`
      const data = n === 1 ? [{ id: 'p1', permalink: 'https://www.instagram.com/p/p1/' }] : []
      return new Response(JSON.stringify({ data, paging: { next } }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchHashtagRecentMedia(fetchFn, { userId: 'u', token: 't', hashtag: '印西' })
    expect(r.media.map((m) => m.id)).toEqual(['p1'])
    expect(r.pages).toBe(2)
    expect(r.truncated).toBe(false)
    expect(n).toBe(2)
  })

  it('1 ページ目が「データ量を減らせ」なら 5 件に絞って再試行する', async () => {
    const calls: string[] = []
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('ig_hashtag_search')) return new Response(JSON.stringify({ data: [{ id: 'H1' }] }), { status: 200 })
      if (url.includes('limit=10')) return new Response(JSON.stringify({ error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } }), { status: 500 })
      return new Response(JSON.stringify({ data: [{ id: 'p1', permalink: 'https://www.instagram.com/p/p1/' }] }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchHashtagRecentMedia(fetchFn, { userId: 'u', token: 't', hashtag: '印西' })
    expect(r.media.map((m) => m.id)).toEqual(['p1'])
    expect(calls.filter((u) => u.includes('recent_media')).map((u) => /limit=(\d+)/.exec(u)?.[1])).toEqual(['10', '5'])
  })

  it('投稿が無いタグは 0 件、それ以外のエラーは投げる', async () => {
    const none = (async () => new Response(JSON.stringify({ error: { message: '(#24) The hashtag does not exist' } }), { status: 400 })) as unknown as typeof fetch
    await expect(fetchHashtagRecentMedia(none, { userId: 'u', token: 't', hashtag: 'zzz' })).resolves.toMatchObject({ media: [], hashtagId: null })
    const bad = (async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190 } }), { status: 400 })) as unknown as typeof fetch
    await expect(fetchHashtagRecentMedia(bad, { userId: 'u', token: 't', hashtag: '印西' })).rejects.toThrow(/Instagram hashtag 400/)
  })
})

describe('日程と行の組み立て', () => {
  const base: FlyerExtract = {
    title: 'ハロウィンマルシェ', description: '仮装して集まろう。', start_at: '2026-10-12T10:00', end_at: '2026-10-12T15:00',
    location: '花の丘公園', online_flag: false, organizer_name: '印西マルシェ実行委員会', capacity: null, fee: 0,
    occurrences: [], confidence: 0.9,
  }

  it('occurrences が空なら start/end から 1 件、終了が無ければ 2 時間後、日付だけなら仮置き', () => {
    expect(occurrencesOf(base)).toEqual([{ start_at: '2026-10-12T10:00', end_at: '2026-10-12T15:00', timeAssumed: false }])
    expect(occurrencesOf({ ...base, end_at: null })).toEqual([{ start_at: '2026-10-12T10:00', end_at: '2026-10-12T12:00', timeAssumed: false }])
    expect(occurrencesOf({ ...base, start_at: '2026-10-12', end_at: null })).toEqual([{ start_at: '2026-10-12T09:00', end_at: '2026-10-12T17:00', timeAssumed: true }])
    expect(occurrencesOf({ ...base, start_at: null })).toEqual([])
  })

  it('複数日程は日付ごとに 1 件、同じ日の重複はまとめる', () => {
    const occs = occurrencesOf({ ...base, occurrences: [
      { start_at: '2026-10-12T10:00', end_at: '2026-10-12T12:00' },
      { start_at: '2026-10-12T14:00', end_at: '2026-10-12T16:00' },
      { start_at: '2026-11-14T10:00', end_at: '2026-11-14T09:00' },
    ] })
    expect(occs.map((o) => o.start_at)).toEqual(['2026-10-12T10:00', '2026-11-14T10:00'])
    expect(occs[1].end_at).toBe('2026-11-14T12:00')
  })

  it('行は draft・bot 名義・出典に投稿リンク・画像は転載しない', () => {
    const m = media({ id: 'p1', caption: '10/12 マルシェ' })
    const row = candidateToRow(base, occurrencesOf(base)[0], m, BOT, '印西')
    expect(row).toMatchObject({
      title: 'ハロウィンマルシェ', category: 'machizukuri', status: 'draft',
      start_at: '2026-10-12T01:00:00.000Z', end_at: '2026-10-12T06:00:00.000Z',
      location: '花の丘公園', fee: 0, capacity: null,
      organizer_type: 'member', organizer_id: BOT, organizer_name_text: '印西マルシェ実行委員会（Instagram #印西 の投稿より）',
      proxy_registration: true, proxy_source_url: 'https://www.instagram.com/p/p1/',
      external_source: 'instagram-hashtag', external_source_id: 'ig:p1:2026-10-12', flyer_image_url: null,
    })
    expect(row.description).toContain('出典：Instagram の #印西 の投稿 https://www.instagram.com/p/p1/')
    expect(row.description).not.toContain('仮置き')
    expect(toCandidateDescription(base, m, '印西', true)).toContain('仮置き')
  })

  it('題名と主催名は 80 字に収める', () => {
    const row = candidateToRow({ ...base, title: 'あ'.repeat(100), organizer_name: 'い'.repeat(100) }, occurrencesOf(base)[0], media({ id: 'p1' }), BOT, '印西')
    expect(row.title.length).toBe(80)
    expect(row.organizer_name_text.length).toBe(80)
  })

  it('同じ日で似た題名なら重複', () => {
    const others: OtherEventRow[] = [{ id: 'x', title: 'ハロウィンマルシェ 2026', start_at: '2026-10-12T02:00:00Z', location: null, organizer_name_text: null }]
    expect(findDuplicateByDateTitle('ハロウィンマルシェ', '2026-10-12', others)?.id).toBe('x')
    expect(findDuplicateByDateTitle('ハロウィンマルシェ', '2026-10-13', others)).toBeNull()
    expect(findDuplicateByDateTitle('防災講座', '2026-10-12', others)).toBeNull()
  })
})

type FakeDb = IgSyncDb & { rows: EventRow[]; usages: { model: string; error: string | null }[] }

function fakeDb(over: Partial<IgSyncDb> & { monthCost?: number; existing?: string[]; scanned?: string[]; future?: OtherEventRow[] } = {}): FakeDb {
  const rows: EventRow[] = []
  const usages: { model: string; error: string | null }[] = []
  return {
    rows, usages,
    loadDiscoveryAuth: async () => ({ user_id: 'u', access_token: 't' }),
    listExistingSourceIds: async () => over.existing ?? [],
    listRecentlyScannedIds: async () => over.scanned ?? [],
    listFutureEvents: async () => over.future ?? [],
    hasEventWithSourceId: async () => false,
    monthCostJpy: async () => over.monthCost ?? 0,
    insert: async (row) => { rows.push(row) },
    recordUsage: async ({ model, error }) => { usages.push({ model, error }); return 1.5 },
    ...over,
  }
}

/** Graph API と画像 CDN の偽 fetch。投稿は引数で渡す */
function fakeFetch(posts: Record<string, unknown>[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('ig_hashtag_search')) return new Response(JSON.stringify({ data: [{ id: 'H1' }] }), { status: 200 })
    if (url.includes('/recent_media')) return new Response(JSON.stringify({ data: posts }), { status: 200 })
    if (url.startsWith('https://cdn.example/')) return new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

const post = (id: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id, caption, media_type: 'IMAGE', media_url: `https://cdn.example/${id}.jpg`, permalink: `https://www.instagram.com/p/${id}/`, timestamp: '2026-10-01T01:00:00+0000', ...extra,
})

const extracted = (over: Partial<FlyerExtract>): FlyerExtract => ({
  title: '防災講座', description: '地域の防災を学ぶ。', start_at: '2026-10-20T10:00', end_at: '2026-10-20T12:00', location: '中央公民館',
  online_flag: false, organizer_name: null, capacity: 30, fee: 0, occurrences: [], confidence: 0.9, ...over,
})

describe('syncInstagramEvents', () => {
  const NOW = new Date('2026-10-01T00:00:00Z') // 09:00 JST

  it('一次ふるいを通った投稿だけ読み取り、今日以降を draft で insert。読み取り済みは再読み取りしない', async () => {
    const db = fakeDb({ scanned: ['old1'] })
    const extract = vi.fn(async (_k: string, _b64: string, _t: string, opts: { hint?: string }) => ({
      ok: true as const,
      data: extracted(opts.hint?.includes('10/20') ? {} : { title: '過去の催し', start_at: '2026-09-01T10:00', end_at: '2026-09-01T12:00' }),
      usage: { input_tokens: 1500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as never,
    }))
    const r = await syncInstagramEvents(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never,
      fetchFn: fakeFetch([
        post('p1', '10/20 防災講座を開催します #印西'),
        post('p2', '9/1 に開催した講座の様子 #印西'),
        post('old1', '10/20 防災講座を開催します #印西'),
        post('p3', '今日のランチ #印西'),
        post('p4', '10/25 コンサート #印西', { media_type: 'VIDEO' }),
      ]),
    })
    expect(r.ok).toBe(true)
    expect(r.fetched).toMatchObject({ list: 5, calendar: 2, details: 2, detailFailed: 0, merged: 2, future: 1 })
    expect(r.prefilter).toMatchObject({ already: 1, noDate: 1, noImage: 1, passed: 2 })
    expect(r.scanned.sort()).toEqual(['p1', 'p2'])
    expect(r.inserted).toEqual(['防災講座（2026-10-20）'])
    expect(r.skipped).toEqual(['過去の催し（2026-09-01）は過去'])
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({ external_source_id: 'ig:p1:2026-10-20', status: 'draft', proxy_source_url: 'https://www.instagram.com/p/p1/' })
    expect(db.usages).toEqual([{ model: 'claude-sonnet-5', error: null }, { model: 'claude-sonnet-5', error: null }])
    expect(r.costJpy).toBe(3)
    // 本文が AI の参考情報として渡る
    expect(extract.mock.calls[0][3].hint).toContain('10/20')
  })

  it('今月の費用が上限なら読み取らずに終了（費用も発生しない）', async () => {
    const db = fakeDb({ monthCost: 500 })
    const extract = vi.fn()
    const r = await syncInstagramEvents(db, { apiKey: 'k', botMemberId: BOT, now: NOW, extract, fetchFn: fakeFetch([post('p1', '10/20 防災講座 #印西')]) })
    expect(r.ok).toBe(true)
    expect(r.budget).toEqual({ monthBeforeJpy: 500, limitJpy: 500, exhausted: true })
    expect(extract).not.toHaveBeenCalled()
    expect(r.skipped[0]).toContain('上限')
    expect(db.rows).toHaveLength(0)
  })

  it('読み取り中に上限へ達したら残りは読まない', async () => {
    const db = fakeDb({ monthCost: 499, recordUsage: async () => 1.5 })
    const extract = vi.fn(async () => ({ ok: true as const, data: extracted({}), usage: null as never }))
    const r = await syncInstagramEvents(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never, maxScansPerRun: 1,
      fetchFn: fakeFetch([post('p1', '10/20 防災講座 #印西'), post('p2', '10/21 料理教室 #印西')]),
    })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(r.budget.exhausted).toBe(true)
    expect(r.skipped.some((s) => s.includes('1回の上限'))).toBe(true)
  })

  it('他の経路に同じ日・似た題名があれば候補にしない。自信度が低い／チラシでない投稿も見送る', async () => {
    const db = fakeDb({ future: [{ id: 'x', title: '防災講座（印西市）', start_at: '2026-10-20T01:00:00Z', location: null, organizer_name_text: null }] })
    const extract = vi.fn(async (_k: string, _b: string, _t: string, opts: { hint?: string }) => ({
      ok: true as const,
      data: opts.hint?.includes('p2') ? extracted({ title: '（読み取り失敗）', confidence: 0 }) : extracted({}),
      usage: null as never,
    }))
    const r = await syncInstagramEvents(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never,
      fetchFn: fakeFetch([post('p1', '10/20 防災講座 #印西'), post('p2', 'p2 10/22 開催 #印西')]),
    })
    expect(r.inserted).toEqual([])
    expect(r.duplicates).toEqual(['防災講座（2026-10-20）= 既存「防災講座（印西市）」'])
    expect(r.skipped.some((s) => s.includes('チラシではない'))).toBe(true)
    expect(db.rows).toHaveLength(0)
  })

  it('同じ画像が「チラシ画像から取り込む」に登録済みなら AI に渡さない', async () => {
    const db = fakeDb({ hasEventWithSourceId: async () => true })
    const extract = vi.fn()
    const r = await syncInstagramEvents(db, { apiKey: 'k', botMemberId: BOT, now: NOW, extract, fetchFn: fakeFetch([post('p1', '10/20 防災講座 #印西')]) })
    expect(extract).not.toHaveBeenCalled()
    expect(r.duplicates[0]).toContain('同じ画像')
    expect(r.scanned).toEqual(['p1'])
  })

  it('dry=1 は insert せず結果だけ返す。トークン未設定は失敗', async () => {
    const db = fakeDb()
    const extract = vi.fn(async () => ({ ok: true as const, data: extracted({}), usage: null as never }))
    const r = await syncInstagramEvents(db, { apiKey: 'k', botMemberId: BOT, now: NOW, dryRun: true, extract: extract as never, fetchFn: fakeFetch([post('p1', '10/20 防災講座 #印西')]) })
    expect(r.dryRun).toBe(true)
    expect(r.inserted).toEqual(['防災講座（2026-10-20）'])
    expect(db.rows).toHaveLength(0)
    await expect(syncInstagramEvents(fakeDb({ loadDiscoveryAuth: async () => null }), { apiKey: 'k', botMemberId: BOT, fetchFn: fakeFetch([]) })).rejects.toThrow(/トークン/)
  })
})
