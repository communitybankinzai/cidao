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

const eventRangeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function jstParts(d: Date) {
  const p = Object.fromEntries(eventRangeFmt.formatToParts(d).map((x) => [x.type, x.value]))
  // 一部の環境は 0時を「24」と返す
  const hour = p.hour === '24' ? '00' : p.hour
  return { year: p.year, md: `${p.month}/${p.day}`, weekday: p.weekday, hm: `${hour}:${p.minute}` }
}

/**
 * イベントの日時を、人が読む形にする（日本時間）。秒は出さない（2026-11-27 事業主決定）。
 *   同じ日　　：「11/28（土）13:00〜16:00」
 *   日をまたぐ：「11/28（土）13:00〜11/29（日）16:00」
 *   今年でない：年を前に付ける「2027/1/23（土）10:30〜12:00」
 *   終了が未定：「11/28（土）13:00〜（終了時刻は未定）」
 * 日時として読めないときは空文字を返す
 */
export function formatEventRangeJst(
  startIso: string,
  endIso: string,
  now: Date = new Date(),
  /** 終了時刻は未定（events.end_time_unknown）。true のとき終了時刻を出さない */
  endUnknown = false,
): string {
  const s = new Date(startIso)
  const e = new Date(endIso)
  if (Number.isNaN(s.getTime())) return ''
  const sp = jstParts(s)
  const thisYear = jstParts(now).year
  const head = `${sp.year !== thisYear ? `${sp.year}/` : ''}${sp.md}（${sp.weekday}）${sp.hm}`
  if (endUnknown) return `${head}〜（終了時刻は未定）`
  if (Number.isNaN(e.getTime())) return head
  const ep = jstParts(e)
  if (ep.year === sp.year && ep.md === sp.md) return `${head}〜${ep.hm}`
  return `${head}〜${ep.year !== sp.year ? `${ep.year}/` : ''}${ep.md}（${ep.weekday}）${ep.hm}`
}

/**
 * 終了時刻が未定の催しの、中で持っておく終了日時（開始の1時間後）。
 * 'YYYY-MM-DDTHH:MM'（日本時間の壁掛け時計）を受け取り、同じ形で返す。読めないときはそのまま返す。
 * カレンダーに出す期間や「終了した催し」の判定が end_at を使うので、未定でも値は入れておく
 */
export function plusOneHourLocal(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return local
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 1, Number(m[5])))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** 保存する終了日時。未定なら開始の1時間後、決まっていれば入力のまま */
export function endAtForSave(startLocal: string, endLocal: string, endUnknown: boolean | undefined): string {
  return endUnknown ? plusOneHourLocal(startLocal) : endLocal
}
