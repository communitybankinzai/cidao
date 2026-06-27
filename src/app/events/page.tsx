import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import EventsBrowser, { type EventRow, type OrgInfo } from './_components/EventsBrowser'

const JST = 'Asia/Tokyo'
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })
function ymdInJst(date: Date): string { return ymdFmt.format(date) }

// JST 基準の月初/月末の UTC 境界
function monthRangeUtc(year: number, month: number): { startUtc: Date; endUtc: Date } {
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
  return {
    y: Number(new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric' }).format(now)),
    m: Number(new Intl.DateTimeFormat('en-CA', { timeZone: JST, month: '2-digit' }).format(now)),
  }
}

// JST 基準で月の前後余白を含む42日（6週）のカレンダーセル
function buildCells(year: number, month: number): string[] {
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

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ ym?: string; view?: string }> }) {
  const sp = await searchParams
  const { y, m } = parseYm(sp.ym)
  const view: 'calendar' | 'list' = sp.view === 'list' ? 'list' : 'calendar'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { startUtc, endUtc } = monthRangeUtc(y, m)
  const fetchStart = new Date(startUtc.getTime() - 7 * 86_400_000)
  const fetchEnd = new Date(endUtc.getTime() + 7 * 86_400_000)

  const { data: events } = await supabase
    .from('events')
    .select('id, title, description, category, start_at, end_at, location, online_flag, organizer_type, organizer_id, organizer_name_text, flyer_image_url')
    .neq('status', 'draft')
    .lt('start_at', fetchEnd.toISOString())
    .gt('end_at', fetchStart.toISOString())
    .order('start_at', { ascending: true })

  const rows: EventRow[] = (events ?? []) as EventRow[]

  // 主催団体情報を一括解決（type / legal_form / logo_url も含む）
  const orgIds = Array.from(new Set(rows.filter((r) => r.organizer_type === 'org').map((r) => r.organizer_id)))
  const { data: orgList } = orgIds.length
    ? await supabase.from('organizations').select('id, name, type, legal_form, logo_url').in('id', orgIds)
    : { data: [] as OrgInfo[] }
  const orgInfo: Record<string, OrgInfo> = {}
  for (const o of (orgList ?? []) as OrgInfo[]) orgInfo[o.id] = o

  const cells = buildCells(y, m)
  const today = ymdInJst(new Date())

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </nav>
        <header className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
              <h1 className="text-2xl md:text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">
                印西市のイベント・活動カレンダー
              </h1>
            </div>
            {user && (
              <Link href="/events/new">
                <Button>イベント登録</Button>
              </Link>
            )}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            印西市内で活動する<strong className="text-slate-800 dark:text-slate-200">市民団体・企業・行政・個人</strong>が主催するイベントをまとめて掲載しています。各イベントをタップすると詳細・参加方法をご覧いただけます。
            {!user && (
              <>
                {' '}
                <Link href="/login" className="underline hover:text-slate-900 dark:hover:text-slate-100">ログイン</Link>
                すると、ご自身のイベントを登録できます。
              </>
            )}
          </p>
        </header>

        <EventsBrowser
          events={rows}
          orgInfo={orgInfo}
          cells={cells}
          year={y}
          month={m}
          today={today}
          isLoggedIn={!!user}
          view={view}
        />
      </div>
    </div>
  )
}
