// 新着イベントの知らせ方（会員ごとの設定）の判定。
//
// 保存先は members.contact_preferences（jsonb）。
//   notify_event       … false なら「受け取らない」（従来からあるキー。前日リマインドもこれで止まる）
//   event_notify_mode  … 'instant'（その都度）| 'digest'（毎日18時にまとめて）| 'off'
// 未設定は「その都度」（これまでの動きのまま）。
//
// notify_event を残してあるのは、到達率カード・前日リマインド・一斉通知の
// 「false の人は送らない」判定が、このキーを見ているため（互換のため両方を書く）。

export type EventNotifyMode = 'instant' | 'digest' | 'off'

export const EVENT_NOTIFY_MODES: readonly EventNotifyMode[] = ['instant', 'digest', 'off']

export function isEventNotifyMode(v: unknown): v is EventNotifyMode {
  return v === 'instant' || v === 'digest' || v === 'off'
}

/** contact_preferences から、その会員の知らせ方を読む。notify_event=false は何があっても「受け取らない」 */
export function eventNotifyMode(prefs: unknown): EventNotifyMode {
  const p = (prefs ?? {}) as Record<string, unknown>
  if (p.notify_event === false) return 'off'
  if (p.event_notify_mode === 'digest') return 'digest'
  return 'instant'
}

/** 保存する値。notify_event は他の仕組みが見ているので、mode と食い違わないよう必ず一緒に書く */
export function eventNotifyPrefs(mode: EventNotifyMode): { notify_event: boolean; event_notify_mode: EventNotifyMode } {
  return { notify_event: mode !== 'off', event_notify_mode: mode }
}

/** 設定画面（/me/edit）の選択肢。文言はここに置いて、画面とヘルプで食い違わないようにする */
export const EVENT_NOTIFY_OPTIONS: readonly { value: EventNotifyMode; label: string; hint: string }[] = [
  {
    value: 'instant',
    label: 'その都度',
    hint: '新しいイベントが載るたびに、すぐお知らせします。会員の登録に加えて、印西市のカレンダーやSNSなどから集めて公開したイベントも含みます。多い日は数通届くので、静かに受け取りたい方は「毎日18時にまとめて」が向いています',
  },
  {
    value: 'digest',
    label: '毎日18時にまとめて',
    hint: '前日18時以降に新しく載ったイベントを、毎日18時に1通でお知らせします。印西市のカレンダーやSNSなどから集めたイベントも含みます。新着がない日は届きません',
  },
  {
    value: 'off',
    label: '受け取らない',
    hint: '新しいイベントのお知らせは届きません。参加登録・「行く予定」にしたイベントの前日の朝のお知らせも届かなくなります',
  },
]

/** 一斉通知（notifyAllMembers）の宛先条件：すぐ知らせるのは「その都度」の人だけ */
export function wantsInstantEvent(prefs: unknown): boolean {
  return eventNotifyMode(prefs) === 'instant'
}

/** 毎日18時のまとめを送る相手 */
export function wantsEventDigest(prefs: unknown): boolean {
  return eventNotifyMode(prefs) === 'digest'
}
