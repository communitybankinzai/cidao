// 通行止め（役所の発表）の読み取りと解除の判定。
// 見本の HTML は 2026-09-22 に各サイトで実際に見た形を縮めたもの。

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inzaiRoadOf,
  kokudoClosureOf,
  parseInzaiStatusPage,
  prefRoadOf,
  scanInzai,
  scanKokudo,
  scanPref,
  syncRoadClosures,
  type ClosureScan,
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

// --- 千葉国道事務所 --------------------------------------------------------------

const KOKUDO_URL = 'https://www.ktr.mlit.go.jp/kisha/chiba_index.html'
const kokudoItem = (date: string, title: string, pdf: string) => `<li><span class="date">${date}</span>
  <dl><dt class="road">道路</dt><dd><a href="/kisha/${pdf}" target="_blank">${title}[PDF：1MB]<img src="x.gif" alt="16"></a></dd></dl></li>`
const kokudoPage = (items: string[]) => `<h1>記者発表資料 千葉国道事務所</h1><ul><li class="kisha_list"><ul>${items.join('')}</ul></li></ul>`

describe('千葉国道事務所', () => {
  it('題名から路線・区間・解除を読む', () => {
    expect(kokudoClosureOf('大雨による通行止めのお知らせ【第1報】　～国道16号　村田町アンダーパス～')).toMatchObject({
      road: '国道16号', place: '村田町アンダーパス', cleared: false, reason: '大雨',
    })
    expect(kokudoClosureOf('大雨による通行止め解除のお知らせ【終報】　～国道127号　小浦(こうら)区間～')).toMatchObject({
      road: '国道127号', place: '小浦区間', cleared: true,
    })
    expect(kokudoClosureOf('千葉市役所前アンダーパスで新たに予防的事前通行規制を導入')).toBeNull()
  })

  it('最後の発表が通行止めなら通行止め中、解除が出たら解除', async () => {
    mockSite({
      [KOKUDO_URL]: kokudoPage([
        kokudoItem('2026年09月22日', '大雨による通行止め解除のお知らせ【終報】　～国道16号　村田町アンダーパス～', 'k569.pdf'),
        kokudoItem('2026年09月21日', '大雨による通行止めのお知らせ【第1報】　～国道127号　元名(もとな)区間～', 'k564.pdf'),
        kokudoItem('2026年09月21日', '大雨による通行止めのお知らせ【第1報】　～国道16号　村田町アンダーパス～', 'k563.pdf'),
      ]),
    })
    const scan = await scanKokudo(source('road-closure-kokudo', KOKUDO_URL, { routes: '16,6' }))
    expect(scan.active).toHaveLength(1)
    expect(scan.active[0]).toMatchObject({ road: '国道127号', place: '元名区間', inArea: false, url: 'https://www.ktr.mlit.go.jp/kisha/k564.pdf' })
    expect(Object.values(scan.cleared)).toEqual(['announced'])
  })

  it('一覧が読めなければ例外（何も解除しない）', async () => {
    mockSite({ [KOKUDO_URL]: '<html><body>メンテナンス中</body></html>' })
    await expect(scanKokudo(source('road-closure-kokudo', KOKUDO_URL))).rejects.toThrow('読めません')
  })
})

// --- 千葉県 --------------------------------------------------------------------

const P = 'https://www.pref.chiba.lg.jp/shared/genrelist/'
const prefLink = (href: string, title: string) => `<li><a href="${href}">${title}</a></li>`

describe('千葉県', () => {
  it('題名から路線と場所を読む', () => {
    expect(prefRoadOf('県道上畑湊線（富津市志駒地先）の通行規制について（令和8年8月7日）'))
      .toEqual({ road: '県道上畑湊線', place: '富津市志駒地先', municipality: '富津市' })
  })

  it('一覧に残っていても、後から同じ路線・場所の解除記事が出たら解除。周辺でない件は in_area=false', async () => {
    mockSite({
      [`${P}pl_6302.html`]: [
        prefLink('/doukan/press/2026/kisei260807.html', '県道上畑湊線（富津市志駒地先）の通行規制について（令和8年8月7日）'),
        prefLink('/doukan/press/2026/kisei260901.html', '県道船橋印西線（印西市草深地先）の通行規制について（令和8年9月1日）'),
        prefLink('/doukan/press/2026/kisei260819.html', '国道410号（君津市大岩地先）の通行規制解除について'),
      ].join(''),
      [`${P}pl_6301.html`]: '',
      [`${P}pl_7310.html`]: prefLink('/doukan/press/2026/kiseikaijo260918.html', '県道上畑湊線（富津市志駒地先）の通行規制解除について（令和8年9月18日）'),
      [`${P}pl_7929.html`]: '',
    })
    const scan = await scanPref(source('road-closure-pref', 'https://www.pref.chiba.lg.jp/cate/baa/lifeline/kendou/index.html'), [])
    expect(scan.active.map((a) => a.road)).toEqual(['県道船橋印西線'])
    expect(scan.active[0]).toMatchObject({ inArea: true, municipality: '印西市' })
    expect(scan.cleared['https://www.pref.chiba.lg.jp/doukan/press/2026/kisei260807.html']).toBe('announced')
  })

  it('通行止めの一覧が 404 なら例外', async () => {
    mockSite({ [`${P}pl_6302.html`]: 404 })
    await expect(scanPref(source('road-closure-pref', ''), [])).rejects.toThrow('HTTP 404')
  })
})

// --- 印西市 --------------------------------------------------------------------

const TOP = 'https://www.city.inzai.lg.jp/'
const topPage = (items: Array<[string, string]>) => `<article class="new"><h2>新着情報</h2><div class="new_lower"><ul>${
  items.map(([href, title]) => `<li><div class="new_lst"><div class="date">9月21日</div><div class="list"><a href="${href}">${title}</a></div></div></li>`).join('')
}</ul></div></article>`
const detail = (h2: string) => `<div id="mol_contents" class="mol_contents"><h2>${h2}</h2><div class="mol_textblock"><p>本文</p></div></div>`
const statusPage = (links: Array<[string, string]>) => `<div class="mol_contents"><h2>台風25号の影響による、道路の通行止めの状況</h2><div class="mol_textblock"><ul>${
  links.map(([href, t]) => `<li><a href="${href}" target="_blank">${t}<span class="newwindow">（別ウインドウで開く）</span></a></li>`).join('')
}</ul></div></div>`

const D1 = `${TOP}0000022576.html`
const D2 = `${TOP}0000022352.html`
const STATUS = `${TOP}0000022578.html`

describe('印西市', () => {
  it('路線と場所を読む', () => {
    expect(inzaiRoadOf('市道師戸・江川線の一部区間')).toEqual({ road: '市道師戸・江川線', place: '一部区間' })
    expect(inzaiRoadOf('道路冠水により、市道吉田・岩戸線の一部区間を通行止めにしています。')).toEqual({ road: '市道吉田・岩戸線', place: '一部区間' })
    expect(inzaiRoadOf('市道山田・平賀線の中平橋付近')).toEqual({ road: '市道山田・平賀線', place: '中平橋付近' })
  })

  it('まとめページのリンクだけを拾う（別ウインドウの注記は除く）', () => {
    expect(parseInzaiStatusPage(statusPage([[D1, '市道師戸・江川線の一部区間']]))).toEqual([{ title: '市道師戸・江川線の一部区間', url: D1 }])
    expect(parseInzaiStatusPage('<html><body>工事中</body></html>')).toBeNull()
  })

  it('新着とまとめページから通行止めを拾う', async () => {
    mockSite({
      [TOP]: topPage([
        ['./0000022576.html', '道路冠水により、市道師戸・江川線の一部区間を通行止めにしています。（令和8年9月21日更新）'],
        ['./0000022503.html', '大雨に係る避難所情報'],
      ]),
      [D1]: detail('道路冠水により、市道師戸・江川線の一部区間を通行止めにしています。'),
      [D2]: detail('中平橋付近　道路冠水による通行止めについて'),
    })
    const scan = await scanInzai(source('road-closure-inzai', TOP, { statusUrls: STATUS }), [])
    // まとめページは 404 → 読めないので解除に使わない。新着の1件だけ
    expect(scan.active).toHaveLength(1)
    expect(scan.active[0]).toMatchObject({ road: '市道師戸・江川線', place: '一部区間', reason: '道路冠水', publishedAt: '2026-09-21T00:00:00+09:00' })
  })

  const onStatusRow = (url: string): ExistingClosure => ({
    closure_key: url, url, in_area: true, cleared_at: null, clear_reason: null,
    raw: { statusUrl: STATUS, onStatus: true, road: '市道師戸・江川線', place: '一部区間', reason: '道路冠水' },
  })

  it('記事の題名が「解除」になったら announced', async () => {
    mockSite({
      [TOP]: topPage([['./0000022503.html', '大雨に係る避難所情報']]),
      [STATUS]: statusPage([[D1, '市道師戸・江川線の一部区間']]),
      [D1]: detail('師戸・江川線の通行止めは解除いたしました'),
    })
    const scan = await scanInzai(source('road-closure-inzai', TOP), [onStatusRow(D1)])
    expect(scan.active).toHaveLength(0)
    expect(scan.cleared[D1]).toBe('announced')
  })

  it('まとめページが空になったら disappeared（事業主提案）', async () => {
    mockSite({
      [TOP]: topPage([['./0000022503.html', '大雨に係る避難所情報']]),
      [STATUS]: statusPage([]),
      [D1]: detail('道路冠水により、市道師戸・江川線の一部区間を通行止めにしています。'),
    })
    const scan = await scanInzai(source('road-closure-inzai', TOP), [onStatusRow(D1)])
    expect(scan.active).toHaveLength(0)
    expect(scan.cleared[D1]).toBe('disappeared')
  })

  it('まとめページも記事も読めない（障害）ときは解除せず前回のまま', async () => {
    mockSite({
      [TOP]: topPage([['./0000022503.html', '大雨に係る避難所情報']]),
      [STATUS]: 503,
      [D1]: 503,
    })
    const scan = await scanInzai(source('road-closure-inzai', TOP), [onStatusRow(D1)])
    expect(scan.active.map((a) => a.key)).toEqual([D1])
    expect(scan.active[0].raw?.keptAsIs).toBe(true)
  })

  it('トップの新着が読めなければ例外', async () => {
    mockSite({ [TOP]: '<html><body>メンテナンス中</body></html>' })
    await expect(scanInzai(source('road-closure-inzai', TOP), [])).rejects.toThrow('新着')
  })
})

// --- 保存と解除 ----------------------------------------------------------------

describe('syncRoadClosures', () => {
  function fakeSupabase() {
    const calls: Array<{ op: string; values?: unknown; key?: unknown }> = []
    const table = {
      insert: async (values: unknown) => { calls.push({ op: 'insert', values }); return { error: null } },
      update: (values: unknown) => ({
        eq: () => ({ eq: async (_col: string, key: unknown) => { calls.push({ op: 'update', values, key }); return { error: null } } }),
      }),
    }
    return { client: { from: () => table } as never, calls }
  }

  it('新しい件は追加、消えた件は理由つきで解除、運営が解除した件は戻さない', async () => {
    const { client, calls } = fakeSupabase()
    const existing: ExistingClosure[] = [
      { closure_key: 'gone', url: null, in_area: true, cleared_at: null, clear_reason: null, raw: {} },
      { closure_key: 'announced', url: null, in_area: true, cleared_at: null, clear_reason: null, raw: {} },
      { closure_key: 'op', url: null, in_area: true, cleared_at: '2026-09-21T00:00:00Z', clear_reason: 'operator', raw: {} },
    ]
    const draft = { road: 'r', place: '', reason: '', municipality: '', inArea: true, url: null, sourceTitle: '', publishedAt: null }
    const scan: ClosureScan = {
      active: [{ ...draft, key: 'new' }, { ...draft, key: 'op' }],
      cleared: { announced: 'announced' },
      notes: [],
    }
    const counts = await syncRoadClosures(client, 'src', scan, existing)
    expect(counts).toEqual({ inserted: 1, updated: 0, cleared: 2 })
    const clears = calls.filter((c) => c.op === 'update').map((c) => [c.key, (c.values as { clear_reason: string }).clear_reason])
    expect(clears).toEqual([['gone', 'disappeared'], ['announced', 'announced']])
  })
})
