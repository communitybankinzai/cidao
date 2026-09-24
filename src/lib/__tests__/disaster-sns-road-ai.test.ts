import { describe, expect, it } from 'vitest'
import { coreLocationName, inArea, locateRoadReport, looksLikeRoadPost } from '../disaster-sns-road-ai'

const extraction = (overrides: Record<string, unknown>) => ({
  is_road_report: true, kind: 'blocked' as const, location_text: '', location_kind: '' as const,
  lat: null, lng: null, observed_at: null, confidence: 'high' as const, summary: '', quote: '', reason: '', ...overrides,
})

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    return new Response(JSON.stringify(key ? routes[key] : []), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { fetcher, calls }
}

describe('前処理', () => {
  it('地名の芯だけ残す', () => {
    expect(coreLocationName('成田湯川駅付近')).toBe('成田湯川駅')
    expect(coreLocationName('印西市 はなのき台 周辺')).toBe('はなのき台')
    expect(coreLocationName('舟戸大橋')).toBe('舟戸大橋')
  })
  it('通行に触れない投稿は AI に渡さない', () => {
    expect(looksLikeRoadPost('避難所が開設されました')).toBe(false)
    expect(looksLikeRoadPost('国道464号が冠水しています')).toBe(true)
    expect(looksLikeRoadPost('通行止めだった舟戸大橋も開通')).toBe(true)
  })
  it('地図の範囲外は捨てる', () => {
    expect(inArea(35.80, 140.20)).toBe(true)
    expect(inArea(35.68, 139.76)).toBe(false)
  })
})

describe('座標化', () => {
  it('橋辞書に載っている名前は外部に問い合わせない', async () => {
    const { fetcher, calls } = fakeFetch({})
    const located = await locateRoadReport(extraction({ location_text: '甚兵衛大橋付近' }), fetcher)
    expect(located).not.toBeNull()
    expect(located?.byModel).toBe(false)
    expect(calls).toHaveLength(0)
  })
  it('Nominatim が近い別物を返したら捨てて次へ進む（舟戸大橋→介護施設）', async () => {
    const { fetcher, calls } = fakeFetch({
      'nominatim.openstreetmap.org': [{ lat: '35.7479', lon: '140.0535', name: '千葉徳洲苑', display_name: '介護老人保健施設 千葉徳洲苑, 船橋市', type: 'social_facility' }],
      'msearch.gsi.go.jp': [],
    })
    const located = await locateRoadReport(extraction({ location_text: '舟戸大橋', lat: 35.7526, lng: 140.1787 }), fetcher)
    expect(calls.some((u) => u.includes('nominatim'))).toBe(true)
    expect(calls.some((u) => u.includes('gsi.go.jp'))).toBe(true)
    // 外部で決まらなければ AI の推定を目安として使う
    expect(located).toMatchObject({ lat: 35.7526, lng: 140.1787, byModel: true })
  })
  it('Nominatim の名前が一致すれば採用する（駅）', async () => {
    const { fetcher } = fakeFetch({
      'nominatim.openstreetmap.org': [{ lat: '35.7995666', lon: '140.2915355', name: '成田湯川駅', display_name: '成田湯川駅, 北千葉道路, 成田市', type: 'train_station' }],
    })
    const located = await locateRoadReport(extraction({ location_text: '成田湯川駅のあたり' }), fetcher)
    expect(located).toMatchObject({ lat: 35.7995666, lng: 140.2915355, byModel: false })
    expect(located?.basis).toContain('OpenStreetMap')
  })
  it('国土地理院の町名は名前が含まれるときだけ採用する', async () => {
    const { fetcher } = fakeFetch({
      'nominatim.openstreetmap.org': [],
      'msearch.gsi.go.jp': [{ geometry: { coordinates: [140.282837, 35.778908] }, properties: { title: '千葉県成田市はなのき台' } }],
    })
    const located = await locateRoadReport(extraction({ location_text: 'はなのき台' }), fetcher)
    expect(located).toMatchObject({ lat: 35.778908, lng: 140.282837 })
    expect(located?.basis).toContain('国土地理院')
  })
  it('場所が無い・範囲外の推定しか無いときは null', async () => {
    const { fetcher } = fakeFetch({})
    expect(await locateRoadReport(extraction({ location_text: '' }), fetcher)).toBeNull()
    expect(await locateRoadReport(extraction({ location_text: '東京駅', lat: 35.681, lng: 139.767 }), fetcher)).toBeNull()
  })
})
