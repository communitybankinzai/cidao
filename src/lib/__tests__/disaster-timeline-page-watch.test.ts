// city-page-watch（固定ページの本文監視）のテスト。
// 市「災害時の公共交通のご案内」のように一覧へ日付つきで並ばないページを対象にする。

import { describe, expect, it, vi, afterEach } from 'vitest'
import { testFetchSource, type InfoSource } from '@/lib/disaster-timeline'

const PAGE = (bodyText: string) => `<!DOCTYPE html><html><body>
<div class="mol_contents"><h1>災害時の公共交通のご案内</h1>
<div class="mol_textblock">${bodyText}</div></div>
</body></html>`

const BODY = [
  '台風25号の接近に伴う公共交通のご利用について（令和8年9月21日 10時00分現在）',
  'JR成田線は、大雨の影響で、成田駅～我孫子駅間の上下線に遅れと運休が出ています。',
  '路線バスの六合路線（小林駅～印旛日本医大駅～京成佐倉駅）は9月21日の午後から運休となります。',
].join('<br>')

function source(config: Record<string, unknown> = {}): InfoSource {
  return {
    id: 'test-source',
    kind: 'city-page-watch',
    label: '印西市 公共交通（市公式）',
    url: 'https://www.city.inzai.lg.jp/0000022520.html',
    config,
    trust: 'official',
    enabled: true,
  }
}

function mockPage(html: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('city-page-watch', () => {
  it('本文・見出し・発表時刻を取り出す', async () => {
    mockPage(PAGE(BODY))
    const [item] = await testFetchSource(source(), { supabase: null })

    expect(item.title).toBe('災害時の公共交通のご案内')
    expect(item.body).toContain('成田駅～我孫子駅間')
    expect(item.body).toContain('六合路線')
    expect(item.url).toBe('https://www.city.inzai.lg.jp/0000022520.html')
    // 「令和8年9月21日 10時00分現在」＝ JST 10:00 → UTC 01:00
    expect(item.occurredAt).toBe('2026-09-21T01:00:00.000Z')
  })

  it('本文が変わると external_key が変わる（＝新しい発表として積む）', async () => {
    mockPage(PAGE(BODY))
    const [first] = await testFetchSource(source(), { supabase: null })
    mockPage(PAGE(BODY.replace('午後から運休', '午後3時から運休')))
    const [second] = await testFetchSource(source(), { supabase: null })

    expect(first.externalKey).not.toBe(second.externalKey)
    expect(first.externalKey.startsWith('page:https://www.city.inzai.lg.jp/0000022520.html#')).toBe(true)
  })

  it('本文が同じなら external_key も同じ（＝重複して積まない）', async () => {
    mockPage(PAGE(BODY))
    const [first] = await testFetchSource(source(), { supabase: null })
    mockPage(PAGE(BODY))
    const [second] = await testFetchSource(source(), { supabase: null })

    expect(first.externalKey).toBe(second.externalKey)
  })

  it('keywords を指定すると、該当語がない平常時の文面は取り込まない', async () => {
    mockPage(PAGE('現在、市内の公共交通に影響はありません。'))
    const quiet = await testFetchSource(source({ keywords: '運休,遅延,運転見合わせ' }), { supabase: null })
    expect(quiet).toHaveLength(0)

    mockPage(PAGE(BODY))
    const active = await testFetchSource(source({ keywords: '運休,遅延,運転見合わせ' }), { supabase: null })
    expect(active).toHaveLength(1)
    expect(active[0].raw?.matchedKeywords).toContain('運休')
  })

  it('本文が取れないときは失敗として知らせる', async () => {
    mockPage('<!DOCTYPE html><html><body><p>本文なし</p></body></html>')
    await expect(testFetchSource(source(), { supabase: null })).rejects.toThrow(/本文が取れません/)
  })
})
