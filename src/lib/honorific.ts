/**
 * 表示名に「さん」を付ける。
 *
 * display_name に「◯◯さん」と敬称込みで登録している人がいるため、
 * そのまま `${name}さん` とすると「◯◯さんさん」になる。
 * 末尾が「さん」で終わっている場合は付け足さない。
 *
 *   nameWithSan('らいさん')   // → 'らいさん'
 *   nameWithSan('中司')       // → '中司さん'
 *   nameWithSan(null)         // → 'メンバーさん'
 */
export function nameWithSan(name: string | null | undefined, fallback = 'メンバー'): string {
  const trimmed = (name ?? '').trim()
  const base = trimmed.length > 0 ? trimmed : fallback
  return base.endsWith('さん') ? base : `${base}さん`
}
