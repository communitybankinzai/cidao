// 日本の祝日・休日かどうかを、日付から計算する（2026-11-23。病院マップが「きょうは祝日か」を知るために作った）。
//
// 外の部品やデータは使わない。「国民の祝日に関する法律」の今の決まり（2022年以降）で計算する：
//   ・日付の決まった祝日、第n月曜の祝日（成人の日・海の日・敬老の日・スポーツの日）
//   ・春分の日・秋分の日は、よく使われる近似式で求める（1980〜2099年に使える。正式な日は前の年の2月に官報で決まる）
//   ・振替休日（祝日が日曜のとき、そのあとの最初の「祝日でない日」）
//   ・国民の休日（前の日と次の日が祝日にはさまれた日）
// 年末年始（12/29〜1/3）は祝日ではないので、1/1 以外は当てはまらない。
// 法律が変わったら（祝日の追加・移動）、ここを直す

function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** y年m月の第n月曜の「日」 */
function nthMonday(y: number, m: number, n: number): number {
  const first = dow(y, m, 1)
  return 1 + ((1 - first + 7) % 7) + (n - 1) * 7
}

function springEquinox(y: number): number {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

function autumnEquinox(y: number): number {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

/** 法律で名前の付いた祝日（振替休日・国民の休日は含まない） */
function isNamedHoliday(y: number, m: number, d: number): boolean {
  switch (m) {
    case 1:
      return d === 1 || d === nthMonday(y, 1, 2)
    case 2:
      return d === 11 || d === 23
    case 3:
      return d === springEquinox(y)
    case 4:
      return d === 29
    case 5:
      return d === 3 || d === 4 || d === 5
    case 7:
      return d === nthMonday(y, 7, 3)
    case 8:
      return d === 11
    case 9:
      return d === nthMonday(y, 9, 3) || d === autumnEquinox(y)
    case 10:
      return d === nthMonday(y, 10, 2)
    case 11:
      return d === 3 || d === 23
    default:
      return false
  }
}

/** n日ずらした日付（月・年をまたいでもよい） */
function shift(y: number, m: number, d: number, n: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]
}

/** 祝日・振替休日・国民の休日のどれかなら true（年・月・日は日本の日付） */
export function isJapaneseHoliday(y: number, m: number, d: number): boolean {
  if (isNamedHoliday(y, m, d)) return true

  // 振替休日：直前に続く祝日の中に日曜があれば、その振替
  let [py, pm, pd] = shift(y, m, d, -1)
  while (isNamedHoliday(py, pm, pd)) {
    if (dow(py, pm, pd) === 0) return true
    ;[py, pm, pd] = shift(py, pm, pd, -1)
  }

  // 国民の休日：前の日と次の日が祝日（日曜は除く）
  if (dow(y, m, d) !== 0) {
    const [ay, am, ad] = shift(y, m, d, -1)
    const [by, bm, bd] = shift(y, m, d, 1)
    if (isNamedHoliday(ay, am, ad) && isNamedHoliday(by, bm, bd)) return true
  }
  return false
}

/** ある時刻の、日本での年・月・日・曜日（0＝日曜）・時 */
export function jstParts(now: Date): { y: number; m: number; d: number; dow: number; hour: number } {
  const t = new Date(now.getTime() + 9 * 3600_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay(), hour: t.getUTCHours() }
}
