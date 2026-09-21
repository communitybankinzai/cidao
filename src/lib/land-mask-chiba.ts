// 千葉県とその周辺の「陸地かどうか」を約200m四方の升目で持つ（国土地理院 標高タイルから作成）。
// 冠水の投稿のうち、海の上に置かれたもの（誤操作など）を地図から除くために使う。
// 作り直しは scripts/build-land-mask-chiba.py。升目に少しでも陸があれば陸とするので、海岸沿いの投稿は残る
import mask from './land-mask-chiba.json'

const bits = Buffer.from(mask.bits, 'base64')

export function isOnLand(lat: number, lon: number): boolean {
  const j = Math.floor((lat - mask.south) / mask.step)
  const i = Math.floor((lon - mask.west) / mask.step)
  if (i < 0 || j < 0 || i >= mask.cols || j >= mask.rows) return false
  const k = j * mask.cols + i
  return ((bits[k >> 3] >> (k & 7)) & 1) === 1
}
