import { describe, expect, it, vi } from 'vitest'
import { fetchAccountMedia, instagramProfileUrl, matchesAccountKeywords, mediaSince, parseAccountKeywords, parseInstagramUsername, type MonitorAccount } from '../accounts'
import { syncInstagramAccounts, type IgAccountSyncDb } from '../sync'
import type { FlyerExtract } from '@/lib/event-flyer-extract'
import type { EventRow } from '@/lib/inzai-bunka/sync'

const BOT = '00000000-0000-0000-0000-000000000bot'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const shokokai: MonitorAccount = { id: 'acc-1', username: 'inzai_shokokai', label: '印西市商工会', kind: '企業', orgId: null }

describe('parseInstagramUsername', () => {
  it('URL・@付き・素の名前から取り出す', () => {
    expect(parseInstagramUsername('https://www.instagram.com/inzai_shokokai/')).toBe('inzai_shokokai')
    expect(parseInstagramUsername('instagram.com/inzai_shokokai?igsh=abc')).toBe('inzai_shokokai')
    expect(parseInstagramUsername('@inzai_shokokai')).toBe('inzai_shokokai')
    expect(parseInstagramUsername('  inzai.shokokai  ')).toBe('inzai.shokokai')
    expect(parseInstagramUsername('https://www.instagram.com/p/Dd7ri2TGMka/')).toBeNull()
    expect(parseInstagramUsername('https://x.com/foo')).toBeNull()
    expect(parseInstagramUsername('')).toBeNull()
    expect(instagramProfileUrl('a_b')).toBe('https://www.instagram.com/a_b/')
  })
})

describe('parseAccountKeywords', () => {
  it('カンマ・読点・セミコロン・改行で分け、空と重複を除く（全角半角・大文字小文字は同じ語）', () => {
    expect(parseAccountKeywords('あめちゃんしょくどう、地域食堂, 地域の居場所\n地域食堂;ＡＢＣ,abc')).toEqual(['あめちゃんしょくどう', '地域食堂', '地域の居場所', 'ＡＢＣ'])
    expect(parseAccountKeywords('  ,、 \n ')).toEqual([])
    expect(parseAccountKeywords('')).toEqual([])
  })

  it('長い語は切り、数は最大12語まで', () => {
    expect(parseAccountKeywords('あ'.repeat(50))[0].length).toBe(30)
    const many = Array.from({ length: 20 }, (_, i) => `語${i}`).join(',')
    expect(parseAccountKeywords(many)).toHaveLength(12)
  })
})

describe('matchesAccountKeywords', () => {
  it('条件語が空（未設定）なら全部通す', () => {
    expect(matchesAccountKeywords('なんでも', [])).toBe(true)
    expect(matchesAccountKeywords('なんでも', undefined)).toBe(true)
    expect(matchesAccountKeywords(null, null)).toBe(true)
  })

  it('どれか1つ本文に含まれれば通す（全角半角・大文字小文字は区別しない）', () => {
    const kw = ['あめちゃんしょくどう', 'ＡＢＣ']
    expect(matchesAccountKeywords('今月のあめちゃんしょくどう、17時から', kw)).toBe(true)
    expect(matchesAccountKeywords('abc kids', kw)).toBe(true)
    expect(matchesAccountKeywords('光るうちわワークショップ', kw)).toBe(false)
    expect(matchesAccountKeywords('', kw)).toBe(false)
    expect(matchesAccountKeywords(undefined, kw)).toBe(false)
  })

  it('空の語だけの設定は、絞り込みにならず全部落ちることはない（空語は一致しない）', () => {
    expect(matchesAccountKeywords('本文', [' '])).toBe(false)
  })
})

describe('fetchAccountMedia', () => {
  it('business_discovery の応答を投稿に整え、account を付ける', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      expect(decodeURIComponent(url)).toContain('business_discovery.username(inzai_shokokai)')
      return new Response(JSON.stringify({
        business_discovery: {
          id: '1784', username: 'inzai_shokokai', name: '印西市商工会', media_count: 120,
          media: { data: [
            { id: 'm1', caption: '11/9 AI活用セミナー', media_type: 'CAROUSEL_ALBUM', media_url: 'https://cdn/m1.jpg', permalink: 'https://www.instagram.com/p/m1/', timestamp: '2026-09-27T01:00:00+0000' },
            { id: 'm2', caption: 'ボウリング', media_type: 'IMAGE', media_url: 'https://cdn/m2.jpg', permalink: 'https://www.instagram.com/p/m2/', timestamp: '2026-09-24T01:00:00+0000' },
          ] },
        },
      }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchAccountMedia(fetchFn, { igUserId: 'u', token: 't', account: shokokai })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.profile).toEqual({ id: '1784', name: '印西市商工会', mediaCount: 120 })
    expect(r.media.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(r.media[0].account).toEqual(shokokai)
    expect(mediaSince(r.media, new Date('2026-09-25T00:00:00Z')).map((m) => m.id)).toEqual(['m1'])
  })

  it('(#10) は権限エラーとして区別し、見つからないアカウントは分かる言葉にする', async () => {
    const denied = (async () => new Response(JSON.stringify({ error: { message: '(#10) Application does not have permission for this action', code: 10 } }), { status: 400 })) as unknown as typeof fetch
    const r1 = await fetchAccountMedia(denied, { igUserId: 'u', token: 't', account: shokokai })
    expect(r1.ok).toBe(false)
    if (!r1.ok) {
      expect(r1.permissionDenied).toBe(true)
      expect(r1.error).toContain('instagram_manage_insights')
    }
    const missing = (async () => new Response(JSON.stringify({ error: { message: '(#100) The username is invalid or the account cannot be found', code: 100 } }), { status: 400 })) as unknown as typeof fetch
    const r2 = await fetchAccountMedia(missing, { igUserId: 'u', token: 't', account: { ...shokokai, username: 'nobody' } })
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.permissionDenied).toBe(false)
      expect(r2.error).toContain('ビジネス／クリエイターアカウントではない')
    }
  })
})

type FakeDb = IgAccountSyncDb & { rows: EventRow[]; status: Record<string, unknown>[] }
function fakeDb(accounts: MonitorAccount[], over: Partial<IgAccountSyncDb> = {}): FakeDb {
  const rows: EventRow[] = []
  const status: Record<string, unknown>[] = []
  return {
    rows, status,
    loadDiscoveryAuth: async () => ({ user_id: 'u', access_token: 't' }),
    listExistingSourceIds: async () => [],
    listRecentlyScannedIds: async () => [],
    listFutureEvents: async () => [],
    hasEventWithSourceId: async () => false,
    monthCostJpy: async () => 0,
    insert: async (row) => { rows.push(row) },
    recordUsage: async () => 2.9,
    listMonitorAccounts: async () => accounts,
    updateAccountStatus: async (id, patch) => { status.push({ id, ...patch }) },
    ...over,
  }
}

const extracted = (over: Partial<FlyerExtract>): FlyerExtract => ({
  title: 'AI活用セミナー', description: '体験型ワークショップ。', start_at: '2026-11-09T14:30', end_at: '2026-11-09T16:30', location: '印西市商工会 2階会議室',
  online_flag: false, organizer_name: '千葉県商工会連合会・印西市商工会', capacity: 20, fee: 0, occurrences: [], confidence: 0.95, ...over,
})

function graphFetch(media: Record<string, unknown>[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('business_discovery')) return new Response(JSON.stringify({ business_discovery: { id: '1', username: 'inzai_shokokai', name: '印西市商工会', media: { data: media } } }), { status: 200 })
    if (url.startsWith('https://cdn/')) return new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

describe('syncInstagramAccounts', () => {
  const NOW = new Date('2026-10-01T00:00:00Z')

  it('対象アカウントの新しい投稿だけ読み取り、候補は @username 付きで記録、状態を書き戻す', async () => {
    const db = fakeDb([shokokai])
    const extract = vi.fn(async () => ({ ok: true as const, data: extracted({}), usage: null as never }))
    const r = await syncInstagramAccounts(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never,
      fetchFn: graphFetch([
        { id: 'm1', caption: '日時：2026年11月9日（月）14:30 AI活用セミナー開催', media_type: 'CAROUSEL_ALBUM', media_url: 'https://cdn/m1.jpg', permalink: 'https://www.instagram.com/p/m1/', timestamp: '2026-09-27T01:00:00+0000' },
        { id: 'm2', caption: '8/9 夏祭りの様子', media_type: 'IMAGE', media_url: 'https://cdn/m2.jpg', permalink: 'https://www.instagram.com/p/m2/', timestamp: '2026-08-10T01:00:00+0000' },
      ]),
    })
    expect(r.ok).toBe(true)
    expect(r.accounts).toEqual([{ username: 'inzai_shokokai', label: '印西市商工会', kind: '企業', orgId: null, posts: 2, fresh: 1, error: null }])
    expect(r.fetched).toMatchObject({ list: 2, calendar: 1, details: 1 })
    expect(r.inserted).toEqual(['AI活用セミナー（2026-11-09） @inzai_shokokai'])
    expect(db.rows[0]).toMatchObject({
      external_source: 'instagram-account', external_source_id: 'ig:m1:2026-11-09', status: 'draft',
      organizer_name_text: '千葉県商工会連合会・印西市商工会（Instagram @inzai_shokokai の投稿より）',
    })
    expect(db.rows[0].description).toContain('出典：Instagram @inzai_shokokai（印西市商工会）の投稿 https://www.instagram.com/p/m1/')
    expect(db.status[0]).toMatchObject({ id: 'acc-1', last_error: null, last_post_at: '2026-09-27T01:00:00.000Z' })
    expect(extract).toHaveBeenCalledTimes(1)
  })

  it('本文に日付が無くても、催しの語があれば読む（日付が画像の中だけの告知）。語も無い投稿は読まない', async () => {
    const db = fakeDb([shokokai])
    const extract = vi.fn(async () => ({ ok: true as const, data: extracted({ title: '海外からこんにちは（Zoom）' }), usage: null as never }))
    const r = await syncInstagramAccounts(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never,
      fetchFn: graphFetch([
        { id: 'z1', caption: '＼第1回 海外からこんにちは！／ Zoomで気軽に参加できます', media_type: 'IMAGE', media_url: 'https://cdn/z1.jpg', permalink: 'https://www.instagram.com/p/z1/', timestamp: '2026-09-27T01:00:00+0000' },
        { id: 'z2', caption: '今日のランチ', media_type: 'IMAGE', media_url: 'https://cdn/z2.jpg', permalink: 'https://www.instagram.com/p/z2/', timestamp: '2026-09-27T02:00:00+0000' },
      ]),
    })
    expect(r.ok).toBe(true)
    expect(r.prefilter).toMatchObject({ noDate: 0, noEventWord: 1, passed: 1 })
    expect(r.scanned).toEqual(['z1'])
    expect(extract).toHaveBeenCalledTimes(1)
    expect(db.rows[0]).toMatchObject({ external_source: 'instagram-account', external_source_id: 'ig:z1:2026-11-09', status: 'draft' })
  })

  it('権限エラーなら残りのアカウントは読まず、errors に案内を残す', async () => {
    const db = fakeDb([shokokai, { ...shokokai, id: 'acc-2', username: 'other' }])
    const denied = (async () => new Response(JSON.stringify({ error: { message: '(#10) no permission', code: 10 } }), { status: 400 })) as unknown as typeof fetch
    const r = await syncInstagramAccounts(db, { apiKey: 'k', botMemberId: BOT, now: NOW, fetchFn: denied, extract: vi.fn() as never })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('instagram_manage_insights')
    expect(r.accounts?.every((a) => a.error)).toBe(true)
    expect(db.status.some((s) => typeof s.last_error === 'string' && String(s.last_error).includes('instagram_manage_insights'))).toBe(true)
  })

  it('居場所系アカウントは、条件語に当たる投稿だけを読み、取り込む催しの種別と目印を固定する', async () => {
    const amechan: MonitorAccount = {
      id: 'acc-3', username: 'dagashiya.amechan', label: 'だがしや あめちゃん', kind: '企業', orgId: null,
      childPlace: 'ibasho', keywords: ['あめちゃんしょくどう', '地域食堂'],
    }
    const db = fakeDb([amechan])
    const extract = vi.fn(async () => ({ ok: true as const, data: extracted({ title: 'あめちゃんしょくどう', organizer_name: 'だがしや あめちゃん' }), usage: null as never }))
    const r = await syncInstagramAccounts(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never,
      fetchFn: graphFetch([
        { id: 'a1', caption: '日時：2026年11月16日（月）17:00 今月のあめちゃんしょくどう開催 #地域食堂', media_type: 'IMAGE', media_url: 'https://cdn/a1.jpg', permalink: 'https://www.instagram.com/p/a1/', timestamp: '2026-09-27T01:00:00+0000' },
        { id: 'a2', caption: '日時：2026年11月20日（金）15:00 光るうちわワークショップ開催', media_type: 'IMAGE', media_url: 'https://cdn/a2.jpg', permalink: 'https://www.instagram.com/p/a2/', timestamp: '2026-09-27T02:00:00+0000' },
      ]),
    })
    expect(r.ok).toBe(true)
    expect(r.accounts?.[0]).toMatchObject({ posts: 2, fresh: 1, skippedByKeyword: 1 })
    expect(extract).toHaveBeenCalledTimes(1) // 食堂以外の投稿は AI に読ませない（費用も出さない）
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({ category: 'kodomo', child_place: 'ibasho', child_place_checked: true, status: 'draft', external_source: 'instagram-account' })
  })

  it('目印を設定していないアカウントは、種別も目印も固定しない（従来どおり）', async () => {
    const db = fakeDb([shokokai])
    const extract = vi.fn(async () => ({ ok: true as const, data: extracted({}), usage: null as never }))
    await syncInstagramAccounts(db, {
      apiKey: 'k', botMemberId: BOT, now: NOW, extract: extract as never,
      fetchFn: graphFetch([
        { id: 'm1', caption: '日時：2026年11月9日（月）14:30 AI活用セミナー開催', media_type: 'IMAGE', media_url: 'https://cdn/m1.jpg', permalink: 'https://www.instagram.com/p/m1/', timestamp: '2026-09-27T01:00:00+0000' },
      ]),
    })
    expect(db.rows[0].category).toBe('machizukuri')
    expect(db.rows[0]).not.toHaveProperty('child_place')
    expect(db.rows[0]).not.toHaveProperty('child_place_checked')
  })

  it('対象が無ければ何もしない', async () => {
    const r = await syncInstagramAccounts(fakeDb([]), { apiKey: 'k', botMemberId: BOT, now: NOW, fetchFn: graphFetch([]), extract: vi.fn() as never })
    expect(r.ok).toBe(true)
    expect(r.skipped[0]).toContain('モニタ対象のアカウントがありません')
  })
})

describe('syncInstagramAccounts：食レポ用のアカウントの条件語（2026-11-13）', () => {
  it('条件語のある食レポ用アカウントは、条件語に当たる投稿だけを食レポに渡す。イベントの読み取りには回さない', async () => {
    const big: MonitorAccount = { id: 'acc-9', username: 'chiba_big', label: '千葉全域の発信者', kind: 'その他', orgId: null, useEvents: false, useGourmet: true, keywords: ['印西', '成田'] }
    const seen: string[][] = []
    const extract = vi.fn()
    await syncInstagramAccounts(fakeDb([big]), {
      apiKey: 'k', botMemberId: BOT, now: new Date('2026-10-01T00:00:00Z'), extract: extract as never,
      fetchFn: graphFetch([
        { id: 'a1', caption: '印西のラーメン店に行ってきた', media_type: 'IMAGE', media_url: 'https://cdn/a1.jpg', permalink: 'https://www.instagram.com/p/a1/', timestamp: '2026-09-27T01:00:00+0000' },
        { id: 'a2', caption: '船橋のカフェ', media_type: 'IMAGE', media_url: 'https://cdn/a2.jpg', permalink: 'https://www.instagram.com/p/a2/', timestamp: '2026-09-28T01:00:00+0000' },
      ]),
      gourmet: async (posts) => { seen.push(posts.map((p) => p.id)); return { enabled: true, read: posts.length, created: 0, skipped: 0, costJpy: 0 } },
    })
    expect(seen).toEqual([['a1']])
    expect(extract).not.toHaveBeenCalled()
  })
})
