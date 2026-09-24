// 通れた道・通れない地点の記録時刻に、最寄りアメダスでどれだけ雨が降っていたか（passed-roads/route.ts から切り出し。2026-09-24）。
// 判定のしきい値をテストで確かめられるよう lib に置く。挙動は route.ts にあったときと同じ。

export type LatLon = [number, number]

// 2点間の距離（m）。短距離なので Haversine で十分
export function distanceM([lat1, lon1]: LatLon, [lat2, lon2]: LatLon) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 記録時刻の最寄りアメダスの雨量。千葉県内で雨量を観測している18地点から最寄りを選ぶ
// （2026-09-22 に千葉県全域へ広げたのに合わせて4地点から拡大。気象庁 amedastable.json の elems 2桁目＝降水量）。
// 「通れない」が冠水によるものか、工事・事故など別の理由かの目安と、「通れた」ときの雨量の参考に使う（確定ではない）。
export const AMEDAS_STATIONS = [
  { code: '45061', name: '我孫子', lat: 35.8633, lon: 140.11 },
  { code: '45081', name: '香取', lat: 35.8583, lon: 140.5017 },
  { code: '45086', name: '東庄', lat: 35.795, lon: 140.6817 },
  { code: '45106', name: '船橋', lat: 35.7117, lon: 140.0433 },
  { code: '45116', name: '佐倉', lat: 35.7283, lon: 140.2117 },
  { code: '45121', name: '成田', lat: 35.7633, lon: 140.385 },
  { code: '45148', name: '銚子', lat: 35.7383, lon: 140.8567 },
  { code: '45181', name: '横芝光', lat: 35.655, lon: 140.505 },
  { code: '45212', name: '千葉', lat: 35.6017, lon: 140.1033 },
  { code: '45261', name: '茂原', lat: 35.4367, lon: 140.2933 },
  { code: '45282', name: '木更津', lat: 35.3617, lon: 139.94 },
  { code: '45291', name: '牛久', lat: 35.3967, lon: 140.1483 },
  { code: '45326', name: '坂畑', lat: 35.235, lon: 140.0983 },
  { code: '45331', name: '大多喜', lat: 35.2517, lon: 140.215 },
  { code: '45346', name: '鋸南', lat: 35.1217, lon: 139.8367 },
  { code: '45361', name: '鴨川', lat: 35.1117, lon: 140.1 },
  { code: '45371', name: '勝浦', lat: 35.15, lon: 140.3117 },
  { code: '45401', name: '館山', lat: 34.9867, lon: 139.865 },
]
export type RainInfo = { station: string; at: string | null; r1h: number | null; r3h: number | null; r24h: number | null; verdict: 'flood_likely' | 'light_rain' | 'no_rain' | 'unknown' }

// 1時間5mm以上・3時間10mm以上・24時間30mm以上のどれかで「冠水のおそれ」、すべて0なら「雨なし」、その間は「小雨」
// （取れた値が1つも無いときは rainAt の側で unknown にする）
export function rainVerdict(r1h: number | null, r3h: number | null, r24h: number | null): RainInfo['verdict'] {
  if ((r1h ?? 0) >= 5 || (r3h ?? 0) >= 10 || (r24h ?? 0) >= 30) return 'flood_likely'
  if ((r1h ?? 0) === 0 && (r3h ?? 0) === 0 && (r24h ?? 0) === 0) return 'no_rain'
  return 'light_rain'
}

function amedasFileUrl(code: string, jst: Date) {
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  const h = String(Math.floor(jst.getUTCHours() / 3) * 3).padStart(2, '0')
  return `https://www.jma.go.jp/bosai/amedas/data/point/${code}/${y}${m}${d}_${h}.json`
}

async function fetchAmedasBlock(code: string, jst: Date) {
  const response = await fetch(amedasFileUrl(code, jst), {
    headers: { Accept: 'application/json', 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`amedas HTTP ${response.status}`)
  return (await response.json()) as Record<string, Record<string, [number, number]>>
}

function pickValue(entry: Record<string, [number, number]> | undefined, key: string) {
  const v = entry?.[key]
  // 気象庁の値は [数値, 品質フラグ]。フラグ 0 だけを正常値として使う
  if (!Array.isArray(v) || v[1] !== 0 || typeof v[0] !== 'number') return null
  return v[0]
}

export async function rainAt(point: LatLon, at: Date): Promise<RainInfo> {
  const station = AMEDAS_STATIONS.reduce((best, s) =>
    distanceM(point, [s.lat, s.lon]) < distanceM(point, [best.lat, best.lon]) ? s : best)
  const unknown: RainInfo = { station: station.name, at: null, r1h: null, r3h: null, r24h: null, verdict: 'unknown' }
  try {
    // 気象庁の10分値は日本時間で3時間ごとのファイル。記録時刻以前で最新の行を使う
    const jst = new Date(at.getTime() + 9 * 3600 * 1000)
    const targetKey = jst.toISOString().replace(/[-:T]/g, '').slice(0, 12) + '00'
    let block = await fetchAmedasBlock(station.code, jst)
    let keys = Object.keys(block).filter((k) => k <= targetKey).sort()
    if (!keys.length) {
      // 3時間ブロックの先頭数分は前のファイルを見る
      block = await fetchAmedasBlock(station.code, new Date(jst.getTime() - 3 * 3600 * 1000))
      keys = Object.keys(block).filter((k) => k <= targetKey).sort()
    }
    const key = keys[keys.length - 1]
    if (!key) return unknown
    const entry = block[key]
    const r1h = pickValue(entry, 'precipitation1h')
    const r3h = pickValue(entry, 'precipitation3h')
    const r24h = pickValue(entry, 'precipitation24h')
    if (r1h === null && r3h === null && r24h === null) return unknown
    const obsAt = new Date(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T${key.slice(8, 10)}:${key.slice(10, 12)}:00+09:00`).toISOString()
    return { station: station.name, at: obsAt, r1h, r3h, r24h, verdict: rainVerdict(r1h, r3h, r24h) }
  } catch (error) {
    console.error('[passed-roads/amedas]', error instanceof Error ? error.message : String(error))
    return unknown
  }
}
