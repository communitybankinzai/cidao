// FreeFree の掲載終了日（日付指定・2026-09-15〜）の計算。
//
// 画面（上限・初期値）とサーバー（検証・期限時刻）が同じ規則を使うよう1か所にまとめる。
// 日付はすべて日本時間の「YYYY-MM-DD」で扱う（文字列のまま大小比較できる）。
// DB にも上限の CHECK（created_at + 3 months 3 days）があり、ここより少し緩くしてある。

export const FREEFREE_MAX_MONTHS = 3 // 掲載日から3ヶ月先まで（開発仕様書 v2.1：6ヶ月以上は協賛枠）
export const FREEFREE_DEFAULT_MONTHS = 1 // 初期値は1ヶ月後（従来の既定「1ヶ月」と同じ）

const JST_OFFSET_MS = 9 * 3600_000
const YMD = /^\d{4}-\d{2}-\d{2}$/

// いまの日本時間の日付
export function jstToday(now = Date.now()): string {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10)
}

// n ヶ月後の同じ日。移動先の月にその日が無ければ月末に丸める（11/30 + 3ヶ月 → 2/28）
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10)
}

export function maxEndDate(now = Date.now()): string {
  return addMonthsYmd(jstToday(now), FREEFREE_MAX_MONTHS)
}

export function defaultEndDate(now = Date.now()): string {
  return addMonthsYmd(jstToday(now), FREEFREE_DEFAULT_MONTHS)
}

// 実在する日付か（2026-02-30 のような日を弾く）
function isRealDate(ymd: string): boolean {
  if (!YMD.test(ymd)) return false
  const t = Date.parse(`${ymd}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === ymd
}

// 形式が正しく、今日〜上限の範囲にあるか
export function isValidEndDate(ymd: string, now = Date.now()): boolean {
  return isRealDate(ymd) && ymd >= jstToday(now) && ymd <= maxEndDate(now)
}

// 編集時の掲載終了日の上限（2026-09-16）。今日ではなく掲載した日から3ヶ月
// （編集で掲載期間を延ばし続けられないように。DB の CHECK も expires_at <= created_at + 3ヶ月3日）
export function maxEndDateForEdit(createdAtIso: string): string {
  return addMonthsYmd(jstYmdOf(createdAtIso), FREEFREE_MAX_MONTHS)
}

// 編集時の掲載終了日の検査。形式が正しく、今日〜掲載日から3ヶ月の範囲にあるか
export function isValidEditEndDate(ymd: string, createdAtIso: string, now = Date.now()): boolean {
  return isRealDate(ymd) && ymd >= jstToday(now) && ymd <= maxEndDateForEdit(createdAtIso)
}

// 終了日の日本時間 23:59:59。その日いっぱい掲載し、日付が変わると一覧から外れる
export function endOfDayJstIso(ymd: string): string {
  return new Date(`${ymd}T23:59:59+09:00`).toISOString()
}

// 日本時間の日付どうしの日数差（b − a）。SNS 告知のカウントダウンに使う
export function daysBetweenYmd(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000)
}

// 日時（ISO 文字列）を日本時間の日付にする。掲載終了日（expires_at＝その日の 23:59:59）の読み戻しに使う
export function jstYmdOf(iso: string): string {
  return jstToday(Date.parse(iso))
}

// 開催日（初日）の検査。実在する日付で、掲載終了日（＝開催最終日）より後ではないこと。
// 複数日のイベントは始まった後に掲載することもあるので、過去の日付も認める
export function isValidStartDate(start: string, end: string): boolean {
  return isRealDate(start) && start <= end
}

// AI が読み取った開催最終日を、選べる範囲に収める。
// 読み取れない・過去の日付なら null（初期値のまま）。上限より先なら上限に丸めて知らせる
export function clampScannedEndDate(
  ymd: string | null | undefined,
  now = Date.now(),
): { date: string; clamped: boolean } | null {
  if (!ymd || !isRealDate(ymd) || ymd < jstToday(now)) return null
  const max = maxEndDate(now)
  return ymd > max ? { date: max, clamped: true } : { date: ymd, clamped: false }
}
