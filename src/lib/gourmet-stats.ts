// 食レポの登録実績（管理画面のグラフ用・2026-11-14）。依存の無い純粋な関数だけを置く。
// 自動／手動の見分け：運営が管理画面で承認したときは decided_by に本人の ID が入り、自動処理（住所調べ・自動承認）は null のまま。

export type RegistrationRow = { created_at: string; auto: boolean }
export type DayCount = { day: string; auto: number; manual: number }

/** 日本時間の日付（YYYY-MM-DD） */
export function jstDay(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

/** 直近 days 日（今日を含む）の日別の登録数。登録の無い日は 0 で埋める */
export function dailyRegistrations(rows: RegistrationRow[], days: number, now: Date = new Date()): DayCount[] {
  const out: DayCount[] = []
  const index = new Map<string, DayCount>()
  for (let i = days - 1; i >= 0; i--) {
    const day = jstDay(new Date(now.getTime() - i * 86_400_000).toISOString())
    const d = { day, auto: 0, manual: 0 }
    out.push(d)
    index.set(day, d)
  }
  for (const r of rows) {
    const d = index.get(jstDay(r.created_at))
    if (!d) continue
    if (r.auto) d.auto++
    else d.manual++
  }
  return out
}

export function totals(series: DayCount[]): { auto: number; manual: number; all: number } {
  const auto = series.reduce((n, d) => n + d.auto, 0)
  const manual = series.reduce((n, d) => n + d.manual, 0)
  return { auto, manual, all: auto + manual }
}
