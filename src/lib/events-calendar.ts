// イベントカレンダー（/events と /events/kodomo）で共通の、日本時間の月まわりの計算。
// もとは src/app/events/page.tsx の中にあったものを、専用ページと共有するために移した（中身は変えていない）。

const JST = 'Asia/Tokyo'
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })

export function ymdInJst(date: Date): string {
  return ymdFmt.format(date)
}

// JST 基準の月初/月末の UTC 境界
export function monthRangeUtc(year: number, month: number): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0))
  const endUtc = new Date(Date.UTC(year, month, 1, -9, 0, 0))
  return { startUtc, endUtc }
}

export function parseYm(raw: string | undefined): { y: number; m: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (m >= 1 && m <= 12) return { y, m }
  }
  const now = new Date()
  return {
    y: Number(new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric' }).format(now)),
    m: Number(new Intl.DateTimeFormat('en-CA', { timeZone: JST, month: '2-digit' }).format(now)),
  }
}

// JST 基準で月の前後余白を含む42日（6週）のカレンダーセル
export function buildCells(year: number, month: number): string[] {
  const firstUtc = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0))
  const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: JST, weekday: 'short' })
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const firstWd = WD.indexOf(wdFmt.format(firstUtc))
  const startMs = firstUtc.getTime() - firstWd * 86_400_000
  const cells: string[] = []
  for (let i = 0; i < 42; i++) {
    cells.push(ymdInJst(new Date(startMs + i * 86_400_000)))
  }
  return cells
}

// 取得する範囲。カレンダー表示は単月＋前後7日、リスト表示は選択月から6ヶ月先まで連続表示するので広げる。
export function fetchWindow(y: number, m: number, view: 'calendar' | 'list'): { fetchStart: Date; fetchEnd: Date } {
  const { startUtc, endUtc } = monthRangeUtc(y, m)
  const fetchStart = new Date(startUtc.getTime() - 7 * 86_400_000)
  const total = y * 12 + (m - 1) + 6
  const listEndUtc = monthRangeUtc(Math.floor(total / 12), (total % 12) + 1).startUtc
  const fetchEnd = new Date((view === 'list' ? listEndUtc : endUtc).getTime() + 7 * 86_400_000)
  return { fetchStart, fetchEnd }
}
