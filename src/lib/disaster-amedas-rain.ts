// 通れた道・通れない地点の記録時刻に、最寄りアメダスでどれだけ雨が降っていたか（passed-roads/route.ts から切り出し。2026-09-24）。
// 判定のしきい値をテストで確かめられるよう lib に置く。挙動は route.ts にあったときと同じ。

import { DEFAULT_RAIN_PARAMS, rainContext, stationWeights, type RainParams } from '@/lib/disaster-rain-logic'

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
export type RainInfo = {
  station: string
  at: string | null
  r1h: number | null
  r3h: number | null
  r24h: number | null
  verdict: 'flood_likely' | 'light_rain' | 'no_rain' | 'unknown'
  // 2026-09-26 からの判定（disaster-rain-logic.ts）。古い判定の行では null
  r72h?: number | null
  peak1h?: number | null
  bucket?: number | null
  api?: number | null
  basis?: 'intensity' | 'aftermath' | null
}

// ⚠ 2026-09-26 から判定には使っていない（rainAt は disaster-rain-logic.ts の rainContext で判定する）。
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

// ---------------------------------------------------------------------------
// 記録の時刻までの10分雨量をそろえて判定する（2026-09-26 作り直し・判定は disaster-rain-logic.ts）
// ---------------------------------------------------------------------------
// 雨量は周辺4か所（30km以内）のアメダスを距離で重み付けした平均。7日分の10分値を使う。
// 手元の控え（disaster_amedas_10min・PCの定期実行で貯めている）を主に使い、控えが記録の時刻に
// 追いついていない直近ぶんだけ気象庁の10分値（3時間ごとのファイル・約1週間で消える）で埋める。

const WINDOW_SLOTS = 1008 // 7日
const SLOT_MS = 10 * 60 * 1000

function floorSlot(ms: number) { return Math.floor(ms / SLOT_MS) * SLOT_MS }

async function backupSeries(stationCode: string, fromMs: number, toMs: number) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const out = new Map<number, number>()
  if (!url || !key) return out
  const query = `disaster_amedas_10min?station_id=eq.${stationCode}`
    + `&observed_at=gt.${new Date(fromMs).toISOString()}&observed_at=lte.${new Date(toMs).toISOString()}`
    + '&select=observed_at,r10_mm,r1h_mm&order=observed_at.asc&limit=1200'
  const response = await fetch(`${url}/rest/v1/${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' })
  if (!response.ok) return out
  const rows = (await response.json()) as Array<{ observed_at: string; r10_mm: number | null; r1h_mm: number | null }>
  for (const r of rows) {
    const t = floorSlot(new Date(r.observed_at).getTime())
    if (r.r10_mm !== null) out.set(t, Number(r.r10_mm))
    else if (r.r1h_mm !== null) {
      // 1時間値だけの行（古い控え）は、その前の1時間の6コマに均等に配る
      for (let j = 0; j < 6; j += 1) if (!out.has(t - j * SLOT_MS)) out.set(t - j * SLOT_MS, Number(r.r1h_mm) / 6)
    }
  }
  return out
}

async function jmaSeries(stationCode: string, fromMs: number, toMs: number, into: Map<number, number>) {
  // 3時間ごとのファイルを新しい方から最大9本（約1日分）まで取る
  const files = new Set<string>()
  for (let t = toMs; t > fromMs && files.size < 9; t -= 3 * 3600 * 1000) files.add(amedasFileUrl(stationCode, new Date(t + 9 * 3600 * 1000)))
  for (const file of files) {
    const response = await fetch(file, {
      headers: { Accept: 'application/json', 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) continue
    const block = (await response.json()) as Record<string, Record<string, [number, number]>>
    for (const [k, entry] of Object.entries(block)) {
      const t = new Date(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}T${k.slice(8, 10)}:${k.slice(10, 12)}:00+09:00`).getTime()
      if (t <= fromMs || t > toMs) continue
      const v = pickValue(entry, 'precipitation10m')
      if (v !== null) into.set(t, v)
    }
  }
}

/** 記録の地点・時刻の10分雨量（重み付け平均・7日分・古い順）と、使った観測点の名前 */
export async function rainSeriesAt(point: LatLon, at: Date) {
  const weights = stationWeights(point, AMEDAS_STATIONS, distanceM)
  const toMs = floorSlot(at.getTime())
  const fromMs = toMs - WINDOW_SLOTS * SLOT_MS
  const perStation = await Promise.all(weights.map(async ({ station }) => {
    let series = new Map<number, number>()
    try { series = await backupSeries(station.code, fromMs, toMs) } catch (error) {
      console.error('[amedas-backup]', error instanceof Error ? error.message : String(error))
    }
    const latest = series.size ? Math.max(...series.keys()) : fromMs
    // 控えが記録の時刻に追いついていなければ、気象庁で埋める（約1週間より前は気象庁にも無い）
    if (toMs - latest > 20 * 60 * 1000 && Date.now() - toMs < 6 * 24 * 3600 * 1000) {
      try { await jmaSeries(station.code, latest, toMs, series) } catch (error) {
        console.error('[amedas-jma]', error instanceof Error ? error.message : String(error))
      }
    }
    return series
  }))
  const values: Array<number | null> = []
  for (let i = WINDOW_SLOTS - 1; i >= 0; i -= 1) {
    const t = toMs - i * SLOT_MS
    let sum = 0
    let w = 0
    weights.forEach(({ weight }, j) => {
      const v = perStation[j].get(t)
      if (v !== undefined) { sum += v * weight; w += weight }
    })
    values.push(w > 0 ? sum / w : null)
  }
  return { values, stations: weights.map((x) => x.station.name), at: new Date(toMs).toISOString() }
}

export async function rainAt(point: LatLon, at: Date, params: RainParams = DEFAULT_RAIN_PARAMS): Promise<RainInfo> {
  const near = stationWeights(point, AMEDAS_STATIONS, distanceM).map((x) => x.station.name).join('・')
  const unknown: RainInfo = { station: near, at: null, r1h: null, r3h: null, r24h: null, verdict: 'unknown' }
  try {
    const { values, stations, at: slotAt } = await rainSeriesAt(point, at)
    const c = rainContext(values, params)
    return {
      station: `${stations.join('・')}の平均`,
      at: slotAt,
      r1h: c.r1h, r3h: c.r3h, r24h: c.r24h, r72h: c.r72h,
      peak1h: c.peak1h3h, bucket: c.bucketMax3h, api: c.api,
      verdict: c.verdict, basis: c.basis,
    }
  } catch (error) {
    console.error('[passed-roads/amedas]', error instanceof Error ? error.message : String(error))
    return unknown
  }
}
