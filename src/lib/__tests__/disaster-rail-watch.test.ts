// 市の公共交通の案内と、地図の運休登録の食い違い検出のテスト。
// 2026-09-21 台風25号の実際の文面（12:00版・18:00版）を使う。

import { describe, expect, it } from 'vitest'
import { busNamesInPage, compareCityTransit, hasTransitDiff } from '@/lib/disaster-rail-watch'
import type { RailStatus } from '@/lib/disaster-rail-status'

const PAGE_1800 = [
  '災害時の公共交通のご案内',
  '台風25号の接近に伴う公共交通のご利用について（令和8年9月21日 18時00分現在）',
  'JR成田線は、台風の影響で、成田駅～我孫子駅間の運転を見合わせています（21日18時現在）。',
  '路線バスについては下記のとおり運休しております（21日18時現在）。',
  '・六合路線（小林駅～印旛日本医大駅～京成佐倉駅）',
  '・宗像路線（全線）',
  '・順大線（平賀学園台～京成酒々井駅）',
  '・神崎線（船尾車庫～八千代方面）',
  '・印旛学園線（仲の台～京成酒々井駅西口）【注意】区間運休',
].join('\n')

// 地図が 12:00 版のまま（宗像路線なし・成田線は「遅れ」扱い）だった状態
const STATUS_1200: RailStatus = {
  railways: [{ line: 'jr-narita-abiko', from: '我孫子', to: '成田', state: 'delayed' }],
  buses: [
    { name: '路線バス 六合路線（小林駅～印旛日本医大駅～京成佐倉駅）' },
    { name: '路線バス 順大線（平賀学園台～京成酒々井駅）' },
    { name: '路線バス 神崎線（船尾車庫～八千代方面）' },
    { name: '路線バス 印旛学園線（仲の台～京成酒々井駅西口）' },
  ],
}

describe('busNamesInPage', () => {
  it('「・〇〇線（…）」の行から路線名を取り出す', () => {
    expect(busNamesInPage(PAGE_1800)).toEqual(['六合路線', '宗像路線', '順大線', '神崎線', '印旛学園線'])
  })

  it('改行のない1行の文面でも取り出せる', () => {
    const flat = PAGE_1800.replace(/\n/g, ' ')
    expect(busNamesInPage(flat)).toContain('宗像路線')
  })
})

describe('compareCityTransit', () => {
  it('12:00版のままの地図に、宗像路線の漏れと成田線の状態違いを指摘する', () => {
    const diff = compareCityTransit(PAGE_1800, STATUS_1200)
    expect(diff.missingBuses).toEqual(['宗像路線'])
    expect(diff.railwayStateChanged).toEqual(['JR成田線：市は「運転見合わせ」、地図は「遅れ」'])
    expect(diff.missingRailways).toEqual([])
    expect(hasTransitDiff(diff)).toBe(true)
  })

  it('地図が最新なら食い違いなし', () => {
    const status: RailStatus = {
      railways: [{ line: 'jr-narita-abiko', from: '我孫子', to: '成田', state: 'suspended' }],
      buses: busNamesInPage(PAGE_1800).map((n) => ({ name: `路線バス ${n}（…）` })),
    }
    expect(hasTransitDiff(compareCityTransit(PAGE_1800, status))).toBe(false)
  })

  it('市が北総線の運休を書いたのに地図になければ知らせる', () => {
    const page = `${PAGE_1800}\n北総線は、線路冠水のため新鎌ヶ谷駅～印旛日本医大駅間で運転を見合わせています。`
    const diff = compareCityTransit(page, STATUS_1200)
    expect(diff.missingRailways).toContain('北総線')
  })

  it('市の文面から消えた項目は「自動で外れる」として並べる', () => {
    const page = '災害時の公共交通のご案内\n現在、市内の鉄道・バスは平常どおり運行しています。'
    const diff = compareCityTransit(page, STATUS_1200)
    expect(diff.goneFromPage).toContain('我孫子〜成田')
    expect(diff.goneFromPage).toContain('路線バス 六合路線')
  })
})
