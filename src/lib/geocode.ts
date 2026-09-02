// 住所 → 緯度経度（国土地理院 住所検索API。無償・キー不要・出典表示不要）
// https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>
// 応答は GeoJSON Feature の配列。先頭を採用する。
//
// 用途: FreeFree掲示物のお店ピン（メタバース印西）。掲載者が入れた住所を保存時に変換する。
// 変換できない・印西市から遠すぎる住所は null を返し、呼び出し側で掲載者に直してもらう。

export type Geocoded = { lat: number; lon: number; title: string }

// 印西市周辺（白井・成田・八千代・柏あたりまで）。これより外は入力ミスとみなす
const BOUNDS = { latMin: 35.5, latMax: 36.1, lonMin: 139.8, lonMax: 140.5 }

export function isNearInzai(lat: number, lon: number): boolean {
  return lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax
}

export async function geocodeAddress(address: string): Promise<Geocoded | null> {
  const q = address.trim().replace(/\s+/g, '')
  if (!q) return null
  const url = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  } catch (err) {
    console.error('[geocode] request failed:', err instanceof Error ? err.message : String(err))
    return null
  }
  if (!res.ok) return null
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return null
  }
  const first = Array.isArray(data) ? (data[0] as { geometry?: { coordinates?: unknown }; properties?: { title?: unknown } }) : null
  const c = first?.geometry?.coordinates
  if (!Array.isArray(c) || c.length < 2) return null
  const lon = Number(c[0])
  const lat = Number(c[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon, title: String(first?.properties?.title ?? '') }
}
