// 運休情報の「解除」判定のテスト。消す方向だけの自動化であることを確かめる。

import { describe, expect, it } from 'vitest'
import { filterRailStatus, type RailStatus } from '@/lib/disaster-rail-status'

const NOW = Date.parse('2026-09-21T12:00:00+09:00')

const STATUS: RailStatus = {
  updatedAt: '2026-09-21T10:00:00+09:00',
  railways: [{
    line: 'jr-narita-abiko',
    from: '我孫子',
    to: '成田',
    state: 'disrupted',
    detail: '成田駅～我孫子駅間の上下線に遅れと運休',
    announcedAt: '2026-09-21T10:00:00+09:00',
  }],
  buses: [{
    name: '路線バス 六合路線（小林駅～印旛日本医大駅～京成佐倉駅）',
    state: 'suspended',
    detail: '9月21日の午後から運休',
    announcedAt: '2026-09-21T10:00:00+09:00',
  }],
}

const PAGE_DISRUPTED = [
  '災害時の公共交通のご案内',
  '台風25号の接近に伴う公共交通のご利用について（令和8年9月21日 10時00分現在）',
  'JR成田線は、大雨の影響で、成田駅～我孫子駅間の上下線に遅れと運休が出ています。',
  '路線バスの六合路線（小林駅～印旛日本医大駅～京成佐倉駅）は9月21日の午後から運休となります。',
].join('\n')

const PAGE_RECOVERED = [
  '災害時の公共交通のご案内',
  '現在、市内及び周辺の鉄道・バスは平常どおり運行しています。（令和8年9月22日 7時00分現在）',
].join('\n')

describe('filterRailStatus', () => {
  it('市の案内にまだ書かれていれば、そのまま地図に出す', () => {
    const r = filterRailStatus(STATUS, PAGE_DISRUPTED, NOW)
    expect(r.railways).toHaveLength(1)
    expect(r.buses).toHaveLength(1)
    expect(r.cleared).toHaveLength(0)
  })

  it('運転再開で記述が消えたら、鉄道もバスも出さない', () => {
    const r = filterRailStatus(STATUS, PAGE_RECOVERED, NOW)
    expect(r.railways).toHaveLength(0)
    expect(r.buses).toHaveLength(0)
    expect(r.cleared.map((c) => c.why)).toEqual([
      '市の案内から記述が消えたため',
      '市の案内から記述が消えたため',
    ])
  })

  it('鉄道だけ再開してバスが残っているときは、バスだけ残す', () => {
    const page = [
      '災害時の公共交通のご案内',
      'JR成田線は平常どおり運行しています。',
      '路線バスの六合路線は引き続き運休です。',
    ].join('\n')
    const r = filterRailStatus(STATUS, page, NOW)
    expect(r.railways).toHaveLength(0)
    expect(r.buses).toHaveLength(1)
  })

  it('発表から12時間を過ぎたものは、案内が取れていても出さない', () => {
    // 発表 10:00 ＋ 12時間 ＝ 22:00 が期限
    const before = Date.parse('2026-09-21T21:00:00+09:00')
    const r = filterRailStatus(STATUS, PAGE_DISRUPTED, before)
    expect(r.railways).toHaveLength(1)

    const after = Date.parse('2026-09-21T23:00:00+09:00')
    const r2 = filterRailStatus(STATUS, PAGE_DISRUPTED, after)
    expect(r2.railways).toHaveLength(0)
    expect(r2.cleared[0].why).toBe('発表から時間が経ったため')
  })

  it('expiresAt があればそちらを優先する', () => {
    const status: RailStatus = {
      railways: [{ ...STATUS.railways![0], expiresAt: '2026-09-21T11:00:00+09:00' }],
    }
    const r = filterRailStatus(status, PAGE_DISRUPTED, NOW)
    expect(r.railways).toHaveLength(0)
    expect(r.cleared[0].why).toBe('発表から時間が経ったため')
  })

  it('市の案内が取れないときは消さない（期限内なら表示を保つ）', () => {
    const r = filterRailStatus(STATUS, '', NOW)
    expect(r.railways).toHaveLength(1)
    expect(r.buses).toHaveLength(1)
  })

  it('運営が確認した事業者発表の項目は、市の案内に無くても消さない（期限だけで消す）', () => {
    const status: RailStatus = {
      railways: [{
        line: 'hokuso', from: '新鎌ヶ谷', to: '印旛日本医大', state: 'suspended',
        sourceType: 'operator', lineLabel: '成田スカイアクセス線',
        announcedAt: '2026-09-21T21:53:00+09:00', expiresAt: '2026-09-22T03:53:00+09:00',
      }],
    }
    const at2200 = Date.parse('2026-09-21T22:00:00+09:00')
    expect(filterRailStatus(status, PAGE_DISRUPTED, at2200).railways).toHaveLength(1)
    expect(filterRailStatus(status, PAGE_RECOVERED, at2200).railways).toHaveLength(1)
    const at0400 = Date.parse('2026-09-22T04:00:00+09:00')
    const r = filterRailStatus(status, PAGE_DISRUPTED, at0400)
    expect(r.railways).toHaveLength(0)
    expect(r.cleared[0].why).toBe('発表から時間が経ったため')
  })
})

