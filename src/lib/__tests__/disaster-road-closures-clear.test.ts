// 通行止めの「解除」の判定。題名の書き換え・記事の削除・取得失敗の3通りを、既存テスト（disaster-road-closures.test.ts）で
// まだ見ていない経路（印旛土木事務所の題名、記事の 404、全種別の通信失敗、scan → sync の通し）について確かめる。

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  scanInba,
  scanInzai,
  scanRoadClosures,
  syncRoadClosures,
  type ExistingClosure,
} from '@/lib/disaster-road-closures'

afterEach(() => { vi.unstubAllGlobals() })

/** URL ごとに返す HTML（無い URL は 404） */
function mockSite(pages: Record<string, string | number>) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const page = pages[String(input)]
    if (page === undefined || typeof page === 'number') return new Response('', { status: typeof page === 'number' ? page : 404 })
    return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } })
  }))
}

const source = (kind: string, url: string, config: Record<string, unknown> = {}) => ({ id: 'src', kind, label: 'test', url, config })

/** 保存先の代わり。update で解除した行の鍵と理由を記録する */
function fakeSupabase() {
  const clears: Array<[unknown, string]> = []
  const table = {
    insert: async () => ({ error: null }),
    update: (values: { clear_reason?: string }) => ({
      eq: () => ({ eq: async (_col: string, key: unknown) => { if (values.clear_reason) clears.push([key, values.clear_reason]); return { error: null } } }),
    }),
  }
  return { client: { from: () => table } as never, clears }
}

// --- 印西市 --------------------------------------------------------------------

const TOP = 'https://www.city.inzai.lg.jp/'
const topPage = (items: Array<[string, string]>) => `<article class="new"><h2>新着情報</h2><div class="new_lower"><ul>${
  items.map(([href, title]) => `<li><div class="new_lst"><div class="date">9月21日</div><div class="list"><a href="${href}">${title}</a></div></div></li>`).join('')
}</ul></div></article>`
const detail = (h2: string) => `<div id="mol_contents" class="mol_contents"><h2>${h2}</h2><div class="mol_textblock"><p>本文</p></div></div>`
const D1 = `${TOP}0000022576.html`
const inzaiRow = (url: string): ExistingClosure => ({
  closure_key: url, url, in_area: true, cleared_at: null, clear_reason: null,
  raw: { road: '市道師戸・江川線', place: '一部区間', reason: '道路冠水' },
})

describe('役所が題名を「解除」に書き換えた場合', () => {
  it('印西市：新着から外れた記事でも、読み直して題名が「解除」なら announced として保存まで通る', async () => {
    // scan で announced になり、sync で clear_reason='announced' として解除されること
    mockSite({
      [TOP]: topPage([['./0000022503.html', '大雨に係る避難所情報']]),
      [D1]: detail('市道師戸・江川線の通行止めを解除しました'),
    })
    const existing = [inzaiRow(D1)]
    const scan = await scanInzai(source('road-closure-inzai', TOP), existing)
    expect(scan.active).toHaveLength(0)
    expect(scan.cleared[D1]).toBe('announced')
    const { client, clears } = fakeSupabase()
    await syncRoadClosures(client, 'src', scan, existing)
    expect(clears).toEqual([[D1, 'announced']])
  })

  it('印旛土木事務所：記事の題名が「解除」になったら、その記事の通行止めをすべて announced', async () => {
    // 1つの記事に2区間あっても、題名が解除なら両方とも解除
    const NEWS = 'https://www.pref.chiba.lg.jp/cs-inba/shinchaku.html'
    const PAGE = 'https://www.pref.chiba.lg.jp/cs-inba/kasen/tsuukoukisei050825.html'
    mockSite({
      [NEWS]: `<div id="tmp_contents"><table class="list_table"><tbody><tr><td class="date">令和8(2026)年9月22日</td><td><a href="/cs-inba/kasen/tsuukoukisei050825.html">通行規制解除のお知らせ│印旛土木事務所</a></td></tr></tbody></table></div>`,
      [PAGE]: `<div id="tmp_contents"><h1>通行規制解除のお知らせ│印旛土木事務所</h1><p>通行止めを解除しました。</p></div>`,
    })
    const rows: ExistingClosure[] = ['#a', '#b'].map((k) => ({
      closure_key: `${PAGE}${k}`, url: PAGE, in_area: true, cleared_at: null, clear_reason: null, raw: { pageUrl: PAGE },
    }))
    const scan = await scanInba(source('road-closure-inba', NEWS), rows, new Date('2026-09-22T12:00:00+09:00'))
    expect(scan.active).toHaveLength(0)
    expect(scan.cleared).toEqual({ [`${PAGE}#a`]: 'announced', [`${PAGE}#b`]: 'announced' })
  })
})

describe('見張っているページから記事が消えた場合', () => {
  it('印西市：通行止めの記事が 404 になったら disappeared', async () => {
    // 記事ページそのものが削除された
    mockSite({ [TOP]: topPage([['./0000022503.html', '大雨に係る避難所情報']]), [D1]: 404 })
    const scan = await scanInzai(source('road-closure-inzai', TOP), [inzaiRow(D1)])
    expect(scan.active).toHaveLength(0)
    expect(scan.cleared[D1]).toBe('disappeared')
  })

  it('印西市：404 ではない障害（503）なら解除せず前回のまま残す', async () => {
    // 削除と一時的な障害を取り違えない
    mockSite({ [TOP]: topPage([['./0000022503.html', '大雨に係る避難所情報']]), [D1]: 503 })
    const scan = await scanInzai(source('road-closure-inzai', TOP), [inzaiRow(D1)])
    expect(scan.cleared[D1]).toBeUndefined()
    expect(scan.active.map((a) => a.key)).toEqual([D1])
  })

  it('印旛土木事務所：記事が 410 になったら、その記事の通行止めを disappeared', async () => {
    // 記事ページが「削除済み」を返した
    const NEWS = 'https://www.pref.chiba.lg.jp/cs-inba/shinchaku.html'
    const PAGE = 'https://www.pref.chiba.lg.jp/cs-inba/kasen/old.html'
    mockSite({
      [NEWS]: `<div id="tmp_contents"><table class="list_table"><tbody><tr><td class="date">令和8(2026)年9月22日</td><td><a href="/cs-inba/index.html">印旛土木事務所</a></td></tr></tbody></table></div>`,
      [PAGE]: 410,
    })
    const row: ExistingClosure = { closure_key: `${PAGE}#a`, url: PAGE, in_area: true, cleared_at: null, clear_reason: null, raw: { pageUrl: PAGE } }
    const scan = await scanInba(source('road-closure-inba', NEWS), [row], new Date('2026-09-22T12:00:00+09:00'))
    expect(scan.cleared).toEqual({ [`${PAGE}#a`]: 'disappeared' })
  })

  it('同期：scan に理由が無く active からも消えた行は disappeared で解除', async () => {
    // scan.cleared に載らなかった行は、理由を disappeared として保存する
    const existing: ExistingClosure[] = [{ closure_key: 'k', url: null, in_area: true, cleared_at: null, clear_reason: null, raw: {} }]
    const { client, clears } = fakeSupabase()
    await syncRoadClosures(client, 'src', { active: [], cleared: {}, notes: [] }, existing)
    expect(clears).toEqual([['k', 'disappeared']])
  })
})

describe('取得に失敗したときは何も解除しない', () => {
  const kinds: Array<[string, string, Record<string, unknown>]> = [
    ['road-closure-kokudo', 'https://www.ktr.mlit.go.jp/kisha/chiba_index.html', {}],
    ['road-closure-pref', 'https://www.pref.chiba.lg.jp/cate/baa/lifeline/kendou/index.html', {}],
    ['road-closure-inzai', TOP, {}],
    ['road-closure-inba', 'https://www.pref.chiba.lg.jp/cs-inba/shinchaku.html', {}],
    ['road-closure-mymap', 'https://www.city.sakura.lg.jp/soshiki/kikikanrika/taihuu25/22665.html', { municipality: '佐倉市', mid: 'x' }],
    ['road-closure-sugumail', 'https://plus.sugumail.com/usr/sakae/doc', { municipality: '栄町' }],
  ]

  it.each(kinds)('%s：通信が失敗したら例外で止まる（scan を返さない＝同期に進まない）', async (kind, url, config) => {
    // 通行止め中の行があっても、読めないときに「消えた」と判断して解除しない
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const existing: ExistingClosure[] = [{ closure_key: url, url, in_area: true, cleared_at: null, clear_reason: null, raw: {} }]
    await expect(scanRoadClosures(source(kind, url, config), existing)).rejects.toThrow()
  })

  it('印旛土木事務所：新着が 503 なら例外', async () => {
    // HTTP エラーも「読めた・空だった」とは扱わない
    const NEWS = 'https://www.pref.chiba.lg.jp/cs-inba/shinchaku.html'
    mockSite({ [NEWS]: 503 })
    await expect(scanInba(source('road-closure-inba', NEWS), [])).rejects.toThrow('HTTP 503')
  })

  it('栄町のメール配信：バックナンバーが 500 なら例外', async () => {
    // fetchRequired の経路でも HTTP エラーで止まる
    const URL_ = 'https://plus.sugumail.com/usr/sakae/doc'
    mockSite({ [URL_]: 500 })
    await expect(scanRoadClosures(source('road-closure-sugumail', URL_), [])).rejects.toThrow('HTTP 500')
  })
})
