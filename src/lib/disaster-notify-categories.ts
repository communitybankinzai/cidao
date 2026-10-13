// 災害通知の種類（設定画面のチェックと対応。prefKey は members.contact_preferences のキー）。
// クライアント部品（マイメニューの設定）も読むため、サーバー専用の処理は置かない。
export const DISASTER_CATEGORIES = [
  { key: 'evac', prefKey: 'notify_disaster_evac', label: '市の避難情報（避難指示など）' },
  { key: 'warning', prefKey: 'notify_disaster_warning', label: '気象警報（特別警報を含む）' },
  { key: 'river', prefKey: 'notify_disaster_river', label: '印旛沼・手賀沼の危険水位' },
  { key: 'closure', prefKey: 'notify_disaster_closure', label: '通行止めの新規発表' },
  { key: 'flood', prefKey: 'notify_disaster_flood', label: '通れない冠水道路の追加' },
  { key: 'fire', prefKey: 'notify_disaster_fire', label: '消防情報（火災・調査活動・事故）' },
] as const

export type DisasterCategory = (typeof DISASTER_CATEGORIES)[number]['key']

/**
 * この会員が、その種類の災害通知を受け取るか。チェックを入れた人だけが対象（2026-10-14 事業主指示）。
 * 親のスイッチ（notify_disaster）と、種類のチェック（prefKey）の両方が true のときだけ。未設定は受け取らない。
 */
export function wantsDisasterNotify(prefs: unknown, prefKey: string): boolean {
  const p = (prefs ?? {}) as Record<string, unknown>
  return p.notify_disaster === true && p[prefKey] === true
}
