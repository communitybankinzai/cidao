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

/**
 * 通知メールの宛名として、表示名に「 様」を付ける。
 * 名前が「◯◯さん」「◯◯様」で終わっている場合は敬称を重ねない。
 *
 *   nameWithSama('山田')     // → '山田 様'
 *   nameWithSama('らいさん') // → 'らいさん'
 *   nameWithSama('田中様')   // → '田中様'
 */
export function nameWithSama(name: string | null | undefined, fallback = 'ご担当'): string {
  const trimmed = (name ?? '').trim()
  const base = trimmed.length > 0 ? trimmed : fallback
  return /(様|さん)$/.test(base) ? base : `${base} 様`
}
