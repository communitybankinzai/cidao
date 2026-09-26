// 「通れない／通れた」の記録が、雨による冠水と考えられるかの判定（2026-09-26 事業主指示で作り直し）。
//
// 以前は「記録した瞬間の最寄りアメダス1か所の 1・3・24時間雨量」で判定していたが、
//   - 降り始めは排水が追いつき、まだ冠水しない
//   - 大雨が止んだ後も、沼・川の水位や低地の水が引くまで通れない（台風25号では雨が止んだ翌日が最多）
// を説明できなかった。そこで次の2つで判定する。
//
//  (A) 排水が追いつかない雨（バケツ）：10分ごとに雨を足し、1時間あたり D mm ずつ抜く。
//      記録の前3時間にあふれた量（バケツの水位の最大）が bucketMm 以上なら「大雨の最中・直後」。
//      D の既定 20mm/h は、台風25号の降っている最中の「通れない」記録から逆算した値（2026-09-26 事業主決定）。
//      一般的な値としては、国の下水道の計画降雨の基本（5年に1回程度の雨）で千葉市が採っていた 50mm/h があり、
//      説明ページで比べられる。農道・低地・沼沿いの道は下水道より排水が弱いと考えられる。
//  (B) 水が引くまでの時間（先行降雨）：ここ数日の雨を、半分になるまで halfLifeH 時間で割り引いて足す。
//      apiMm 以上なら「大雨の後で水が残っているおそれ」。既定値は台風25号の記録で当てはめた値。
//
// 雨量は周辺のアメダス4か所を距離の2乗の逆数で重み付けした平均（印西市内に観測点が無いため）。
// 同じ計算を防災MAPの説明ページ（site/inzai-disaster-map/rain-logic.html）でも行い、誰でも数値を変えて試せる。
// ⚠ 式や既定値を変えるときは、そのページの JS と説明文も必ず揃えること。

export type RainParams = {
  drainMmPerHour: number // D：排水が追いつく雨の強さ（mm/h）
  bucketMm: number // (A) のしきい値：前3時間にあふれた量の最大（mm）
  halfLifeH: number // (B) の半減期（時間）
  apiMm: number // (B) のしきい値：割り引いた雨の合計（mm）
}

// 判定の版。式や既定値を変えたら上げ、scripts/backfill-rain-logic.ts で全記録を判定し直す
export const RAIN_LOGIC_VERSION = 'v2.1-2026-09-26'

export const DEFAULT_RAIN_PARAMS: RainParams = {
  drainMmPerHour: 20,
  bucketMm: 1,
  halfLifeH: 48,
  apiMm: 150,
}

export type RainContext = {
  r1h: number
  r3h: number
  r24h: number
  r72h: number
  peak1h3h: number // 前3時間で一番強かった1時間の雨（mm）
  bucketMax3h: number // 前3時間のバケツの水位の最大（あふれた量・mm）
  api: number // 割り引いた雨の合計（mm）
  verdict: 'flood_likely' | 'light_rain' | 'no_rain' | 'unknown'
  basis: 'intensity' | 'aftermath' | null // flood_likely の理由
}

/**
 * values：記録の時刻までの10分雨量（mm・古い順・最後が記録の時刻を含む10分）。null は欠測。
 * 7日分（1008コマ）あると割り引きの端の影響が1割未満になる。24時間のうち3割以上欠けていたら unknown。
 */
export function rainContext(values: Array<number | null>, params: RainParams = DEFAULT_RAIN_PARAMS): RainContext {
  const n = values.length
  const last24 = values.slice(-144)
  const missing = last24.filter((v) => v === null).length
  const v = values.map((x) => x ?? 0)
  const sum = (k: number) => Math.round(v.slice(-k).reduce((a, b) => a + b, 0) * 10) / 10
  const drainPer10 = params.drainMmPerHour / 6
  const k = 0.5 ** (1 / (6 * params.halfLifeH))
  let bucket = 0
  let api = 0
  let bucketMax3h = 0
  for (let i = 0; i < n; i += 1) {
    bucket = Math.max(0, bucket + v[i] - drainPer10)
    api = api * k + v[i]
    if (i >= n - 18) bucketMax3h = Math.max(bucketMax3h, bucket)
  }
  let peak1h3h = 0
  for (let i = Math.max(0, n - 18); i + 6 <= n; i += 1) {
    peak1h3h = Math.max(peak1h3h, v.slice(i, i + 6).reduce((a, b) => a + b, 0))
  }
  const base = {
    r1h: sum(6), r3h: sum(18), r24h: sum(144), r72h: sum(432),
    peak1h3h: Math.round(peak1h3h * 10) / 10,
    bucketMax3h: Math.round(bucketMax3h * 10) / 10,
    api: Math.round(api * 10) / 10,
  }
  if (n < 144 || missing > 144 * 0.3) return { ...base, verdict: 'unknown', basis: null }
  if (bucketMax3h >= params.bucketMm) return { ...base, verdict: 'flood_likely', basis: 'intensity' }
  if (api >= params.apiMm) return { ...base, verdict: 'flood_likely', basis: 'aftermath' }
  if (base.r72h >= 0.5) return { ...base, verdict: 'light_rain', basis: null }
  return { ...base, verdict: 'no_rain', basis: null }
}

/** 周辺の観測点（近い順に最大4か所・30km以内）と重み（距離の2乗の逆数・合計1） */
export function stationWeights<T extends { lat: number; lon: number }>(
  point: [number, number],
  stations: T[],
  distance: (a: [number, number], b: [number, number]) => number,
) {
  const near = stations
    .map((s) => ({ s, d: distance(point, [s.lat, s.lon]) }))
    .sort((a, b) => a.d - b.d)
  const within = near.filter((x) => x.d <= 30000).slice(0, 4)
  const use = within.length ? within : near.slice(0, 1)
  const raw = use.map((x) => ({ station: x.s, w: 1 / Math.max(x.d / 1000, 1) ** 2 }))
  const total = raw.reduce((a, b) => a + b.w, 0)
  return raw.map((x) => ({ station: x.station, weight: x.w / total }))
}
