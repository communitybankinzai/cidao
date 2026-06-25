import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { categoryLabel } from '@/lib/categories'

const JST = 'Asia/Tokyo'
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })
const hmFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: JST, hour: '2-digit', minute: '2-digit', hour12: false })

function ymdInJst(date: Date): string { return ymdFmt.format(date) }

// JST 基準の月初/月末の UTC 境界を返す
function monthRangeUtc(year: number, month: number): { startUtc: Date; endUtc: Date } {
  // JST = UTC+9。JST の月初 00:00 は UTC で前日 15:00。
  const startUtc = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0))
  const endUtc = new Date(Date.UTC(year, month, 1, -9, 0, 0))
  return { startUtc, endUtc }
}

function parseYm(raw: string | undefined): { y: number; m: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (m >= 1 && m <= 12) return { y, m }
  }
  const now = new Date()
  return { y: Number(new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric' }).format(now)), m: Number(new Intl.DateTimeFormat('en-CA', { timeZone: JST, month: '2-digit' }).format(now)) }
}

function shiftMonth(y: number, m: number, delta: number): string {
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

// JST 基準で月の前後余白を含む42日（6週）のカレンダーセル
function buildCells(year: number, month: number): string[] {
  // JST 月初の曜日（0=Sun）を求める
  const firstUtc = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0))
  // firstUtc を JST 表現にすると year-month-01。weekday を JST で取得
  const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: JST, weekday: 'short' })
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const firstWd = WD.indexOf(wdFmt.format(firstUtc))
  // 6週グリッドの開始日（前月の日曜）
  const startMs = firstUtc.getTime() - firstWd * 86_400_000
  const cells: string[] = []
  for (let i = 0; i < 42; i++) {
    cells.push(ymdInJst(new Date(startMs + i * 86_400_000)))
  }
  return cells
}

type EventRow = {
  id: string
  title: string
  category: string
  start_at: string
  end_at: string
  location: string | null
  online_flag: boolean
  organizer_type: 'member' | 'org'
  organizer_id: string
  organizer_name_text: string | null
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ ym?: string; view?: string }> }) {
  const sp = await searchParams
  const { y, m } = parseYm(sp.ym)
  const view = sp.view === 'list' ? 'list' : 'calendar'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { startUtc, endUtc } = monthRangeUtc(y, m)
  // グリッドは月の前後にはみ出すので、±1週の余白を取って取得
  const fetchStart = new Date(startUtc.getTime() - 7 * 86_400_000)
  const fetchEnd = new Date(endUtc.getTime() + 7 * 86_400_000)

  const { data: events } = await supabase
    .from('events')
    .select('id, title, category, start_at, end_at, location, online_flag, organizer_type, organizer_id, organizer_name_text')
    .neq('status', 'draft')
    .gte('start_at', fetchStart.toISOString())
    .lt('start_at', fetchEnd.toISOString())
    .order('start_at', { ascending: true })

  const rows: EventRow[] = (events ?? []) as EventRow[]

  // 主催団体の名前を一括解決
  const orgIds = Array.from(new Set(rows.filter((r) => r.organizer_type === 'org').map((r) => r.organizer_id)))
  const { data: orgList } = orgIds.length
    ? await supabase.from('organizations').select('id, name').in('id', orgIds)
    : { data: [] as { id: string; name: string }[] }
  const orgName = new Map((orgList ?? []).map((o) => [o.id, o.name]))

  function organizerLabel(r: EventRow): string {
    if (r.organizer_type === 'org') return orgName.get(r.organizer_id) ?? '団体'
    if (r.organizer_name_text) return `${r.organizer_name_text}（代理登録）`
    return '個人主催'
  }

  // 日付ごとのイベント集約
  const byDate = new Map<string, EventRow[]>()
  for (const r of rows) {
    const key = ymdInJst(new Date(r.start_at))
    const list = byDate.get(key) ?? []
    list.push(r)
    byDate.set(key, list)
  }

  const cells = buildCells(y, m)
  const today = ymdInJst(new Date())
  const monthLabel = `${y}年${m}月`
  const prevYm = shiftMonth(y, m, -1)
  const nextYm = shiftMonth(y, m, 1)
  const thisYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </nav>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
            <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">イベント</h1>
          </div>
          {user && (
            <Link href="/events/new">
              <Button>イベント登録</Button>
            </Link>
          )}
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Link href={`/events?ym=${prevYm}${view === 'list' ? '&view=list' : ''}`}>
              <Button variant="outline" size="sm" aria-label="前の月">‹</Button>
            </Link>
            <span className="px-3 text-lg font-medium tabular-nums">{monthLabel}</span>
            <Link href={`/events?ym=${nextYm}${view === 'list' ? '&view=list' : ''}`}>
              <Button variant="outline" size="sm" aria-label="次の月">›</Button>
            </Link>
            <Link href={`/events?ym=${thisYm}${view === 'list' ? '&view=list' : ''}`}>
              <Button variant="ghost" size="sm">今月</Button>
            </Link>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <Link href={`/events?ym=${y}-${String(m).padStart(2, '0')}`}>
              <Button variant={view === 'calendar' ? 'default' : 'outline'} size="sm">カレンダー</Button>
            </Link>
            <Link href={`/events?ym=${y}-${String(m).padStart(2, '0')}&view=list`}>
              <Button variant={view === 'list' ? 'default' : 'outline'} size="sm">リスト</Button>
            </Link>
          </div>
        </div>

        {view === 'calendar' ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="grid grid-cols-7 text-[11px] font-medium border-b border-slate-200 dark:border-slate-800">
              {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
                <div
                  key={w}
                  className={`px-2 py-1.5 text-center ${i === 0 ? 'text-rose-600 dark:text-rose-400' : i === 6 ? 'text-sky-600 dark:text-sky-400' : 'text-slate-600 dark:text-slate-400'}`}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 grid-rows-6">
              {cells.map((ymd, idx) => {
                const [cy, cm, cd] = ymd.split('-').map(Number)
                const inMonth = cy === y && cm === m
                const dow = idx % 7
                const isToday = ymd === today
                const items = byDate.get(ymd) ?? []
                return (
                  <div
                    key={ymd}
                    className={`min-h-[92px] md:min-h-[110px] border-r border-b border-slate-100 dark:border-slate-800 last:border-r-0 p-1 flex flex-col gap-1 ${inMonth ? '' : 'bg-slate-50/60 dark:bg-slate-950/40'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs tabular-nums ${
                          isToday
                            ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : !inMonth
                            ? 'text-slate-300 dark:text-slate-700'
                            : dow === 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : dow === 6
                            ? 'text-sky-600 dark:text-sky-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {cd}
                      </span>
                      {user && inMonth && (
                        <Link
                          href={`/events/new?date=${ymd}`}
                          aria-label={`${ymd} にイベント登録`}
                          className="opacity-0 hover:opacity-100 focus:opacity-100 text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-1"
                        >
                          ＋
                        </Link>
                      )}
                    </div>
                    <ul className="flex flex-col gap-0.5 overflow-hidden">
                      {items.slice(0, 3).map((e) => (
                        <li key={e.id}>
                          <Link
                            href={`/events/${e.id}`}
                            title={`${hmFmt.format(new Date(e.start_at))} ${e.title} / ${organizerLabel(e)}`}
                            className="block truncate text-[11px] px-1 py-0.5 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-100"
                          >
                            <span className="tabular-nums mr-1">{hmFmt.format(new Date(e.start_at))}</span>
                            {e.title}
                          </Link>
                        </li>
                      ))}
                      {items.length > 3 && (
                        <li className="text-[10px] text-slate-500 px-1">+{items.length - 3} 件</li>
                      )}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <ListView events={rows} organizerLabel={organizerLabel} />
        )}
      </div>
    </div>
  )
}

function ListView({ events, organizerLabel }: { events: EventRow[]; organizerLabel: (r: EventRow) => string }) {
  if (events.length === 0) {
    return <p className="text-slate-400 text-center py-12">この月のイベントはありません</p>
  }
  return (
    <ul className="space-y-3">
      {events.map((e) => (
        <li key={e.id}>
          <Link
            href={`/events/${e.id}`}
            className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-slate-400 transition"
          >
            <div className="flex justify-between mb-1 gap-2">
              <h2 className="text-lg font-semibold">{e.title}</h2>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {new Date(e.start_at).toLocaleDateString('ja-JP', { timeZone: JST })} {hmFmt.format(new Date(e.start_at))}
              </span>
            </div>
            <div className="flex gap-2 text-xs flex-wrap items-center">
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(e.category)}</span>
              <span className="text-slate-500">主催: {organizerLabel(e)}</span>
              {e.online_flag && <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900 rounded">オンライン</span>}
              {e.location && <span className="text-slate-500">📍 {e.location}</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
