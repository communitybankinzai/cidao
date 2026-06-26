// イベント等の日時は DB に timestamptz（UTC）で保存し、表示時に JST へ変換する方針。
//
// フォームの <input type="datetime-local"> や COCoLa ingest は「JST の壁掛け時計の時刻」
// （"YYYY-MM-DDTHH:MM" / タイムゾーン情報なし）を送ってくる。これをそのまま timestamptz に
// 入れると Postgres がセッションTZ（既定 UTC）で解釈し、表示（JST）で +9時間ずれる。
//
// → 書き込み前に必ず jstLocalToUtcIso() で UTC ISO に変換すること。
// 読み取り（表示）側は Asia/Tokyo で format すればよい（既存の toLocalDatetime / hmFmt 等）。

const JST_OFFSET = '+09:00'

/**
 * JST の壁掛け時計表現（"YYYY-MM-DDTHH:MM" 等、TZ情報なし）を UTC ISO 文字列に変換する。
 * - 既に Z や ±HH:MM のオフセットを含む文字列はそのまま返す（二重変換防止）。
 * - パースできない文字列はそのまま返す（バリデーションは呼び出し側の責務）。
 */
export function jstLocalToUtcIso(s: string | null | undefined): string {
  if (!s) return s ?? ''
  // 既にタイムゾーン情報を含む（末尾 Z、または ±HH:MM）ならそのまま
  if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return s
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  if (!m) return s
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${JST_OFFSET}`)
  if (Number.isNaN(d.getTime())) return s
  return d.toISOString()
}
