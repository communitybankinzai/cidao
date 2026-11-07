import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { buildCells, fetchWindow, parseYm, ymdInJst } from '@/lib/events-calendar'
import {
  CHILD_PLACE_KINDS,
  parseChildPlaceTag,
  summarizeChildPlace,
  tagKinds,
  type ChildPlaceEventRow,
  type ChildPlaceKey,
  type ChildPlaceSummary,
} from '@/lib/child-place'
import EventsBrowser, { type EventRow, type OrgInfo } from '../_components/EventsBrowser'

const DESCRIPTION =
  '印西市内で開かれている、子どもや親子が安心して過ごせる場（子ども食堂・プレーパーク・おやこカフェ・図書館のおはなし会など）をまとめたカレンダーです。'

export const metadata: Metadata = {
  title: 'こどもの居場所カレンダー｜CiDAO',
  description: DESCRIPTION,
}

export default async function KodomoCalendarPage({ searchParams }: { searchParams: Promise<{ ym?: string; view?: string; tag?: string }> }) {
  const sp = await searchParams
  const { y, m } = parseYm(sp.ym)
  const view: 'calendar' | 'list' = sp.view === 'list' ? 'list' : 'calendar'
  // この専用ページは常に「子どもの居場所」。?tag=ibasho / oyako で片方だけに絞れる
  const tag = parseChildPlaceTag(sp.tag) ?? 'kodomo'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: isAdmin } = user ? await supabase.rpc('is_admin') : { data: false }

  // ---- カレンダー／リスト（/events と同じ部品・同じ取り方。絞り込みは常に子どもの居場所）
  const { fetchStart, fetchEnd } = fetchWindow(y, m, view)
  const { data: events } = await supabase
    .from('events')
    .select('id, title, description, category, start_at, end_at, location, online_flag, organizer_type, organizer_id, organizer_name_text, flyer_image_url, child_place')
    .neq('status', 'draft')
    .lt('start_at', fetchEnd.toISOString())
    .gt('end_at', fetchStart.toISOString())
    .in('child_place', tagKinds(tag))
    .order('start_at', { ascending: true })
  const rows: EventRow[] = (events ?? []) as EventRow[]

  // ---- 実績サマリー（期間で区切らず、公開中の目印つきをすべて数える。中止・下書きは数えない）
  const { data: allRaw } = await supabase
    .from('events')
    .select('start_at, child_place, child_place_checked, organizer_type, organizer_id, organizer_name_text')
    .eq('status', 'open')
    .not('child_place', 'is', null)
    .order('start_at', { ascending: true })
    .limit(5000)
  const all = (allRaw ?? []) as {
    start_at: string
    child_place: ChildPlaceKey
    child_place_checked: boolean
    organizer_type: 'member' | 'org'
    organizer_id: string
    organizer_name_text: string | null
  }[]

  // 主催団体情報（カレンダー用とサマリー用をまとめて解決）
  const orgIds = Array.from(new Set([...rows, ...all].filter((r) => r.organizer_type === 'org').map((r) => r.organizer_id)))
  const { data: orgList } = orgIds.length
    ? await supabase.from('organizations').select('id, name, type, legal_form, logo_url').in('id', orgIds)
    : { data: [] as OrgInfo[] }
  const orgInfo: Record<string, OrgInfo> = {}
  for (const o of (orgList ?? []) as OrgInfo[]) orgInfo[o.id] = o

  const summaryRows: ChildPlaceEventRow[] = all.map((r) => ({
    start_at: r.start_at,
    child_place: r.child_place,
    child_place_checked: r.child_place_checked,
    organizer_name: r.organizer_type === 'org' ? (orgInfo[r.organizer_id]?.name ?? r.organizer_name_text) : r.organizer_name_text,
  }))
  const now = new Date()
  const summary = summarizeChildPlace(summaryRows, now.getTime())

  const cells = buildCells(y, m)
  const today = ymdInJst(now)

  return (
    <PageShell feature="events" width="default">
      <PageHeader
        feature="events"
        title="こどもの居場所カレンダー"
        description={
          <>
            {DESCRIPTION}
            CiDAO に載っているイベントのうち、題名・主催名からの自動判定と、主催者・運営の確認で目印を付けたものだけを集めています。
          </>
        }
        actions={
          <Link href="/events" className="text-sm underline text-slate-600 dark:text-slate-300 print:hidden">
            すべてのイベントを見る →
          </Link>
        }
      />

      <SummaryCard summary={summary} />

      <EventsBrowser
        events={rows}
        orgInfo={orgInfo}
        cells={cells}
        year={y}
        month={m}
        today={today}
        isLoggedIn={!!user}
        view={view}
        currentUserId={user?.id ?? null}
        isAdmin={!!isAdmin}
        tag={tag}
        basePath="/events/kodomo"
      />

      <p className="mt-6 text-xs text-slate-500 dark:text-slate-400 print:hidden">
        主催の方へ：イベントの{' '}
        <Link href="/events/new" className="underline">登録</Link>
        {' '}・編集の画面にある「子どもの居場所」の欄で、このカレンダーに載せるかどうかを選べます。分からなければ「自動」のままで構いません。
      </p>
    </PageShell>
  )
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

function SummaryCard({ summary }: { summary: ChildPlaceSummary }) {
  const maxMonth = Math.max(1, ...summary.months.map((mo) => mo.ibasho + mo.oyako))
  const top = summary.organizerList.slice(0, 10)
  const tiles: { label: string; value: number; unit: string; note?: string }[] = [
    { label: '掲載された開催', value: summary.total, unit: '回', note: summary.firstYm && summary.lastYm ? `${ymLabel(summary.firstYm)}〜${ymLabel(summary.lastYm)}` : undefined },
    { label: 'うち開催日が過ぎたもの', value: summary.past, unit: '回' },
    { label: 'これから', value: summary.upcoming, unit: '回' },
    { label: '主催団体', value: summary.organizers, unit: '団体', note: '表記ゆれは同じ団体として数えています' },
  ]

  return (
    <section aria-labelledby="kodomo-summary" className="mb-6 space-y-4 rounded-lg border bg-white p-4 dark:bg-slate-900 print:break-inside-avoid">
      <h2 id="kodomo-summary" className="text-base font-semibold">掲載の状況</h2>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-slate-200 p-3 dark:border-slate-700">
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t.label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">
              {t.value}
              <span className="ml-1 text-sm font-normal text-slate-500">{t.unit}</span>
            </dd>
            {t.note && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{t.note}</p>}
          </div>
        ))}
      </dl>

      <div className="grid gap-3 md:grid-cols-2">
        {CHILD_PLACE_KINDS.map((k) => {
          const b = summary.byKind[k.key]
          return (
            <div key={k.key} className="rounded border border-slate-200 p-3 text-sm dark:border-slate-700">
              <p className="font-medium">
                <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm ${k.key === 'ibasho' ? 'bg-amber-400' : 'bg-sky-400'}`} aria-hidden />
                {k.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{k.desc}</p>
              <p className="mt-1 tabular-nums">
                {b.count}回（過ぎたもの {b.past}／これから {b.upcoming}）・{b.organizers}団体
              </p>
            </div>
          )
        })}
      </div>

      {summary.months.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">月ごとの掲載数</h3>
          <ul className="space-y-1">
            {summary.months.map((mo) => {
              const sum = mo.ibasho + mo.oyako
              return (
                <li key={mo.ym} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 tabular-nums text-slate-600 dark:text-slate-300">{ymLabel(mo.ym)}</span>
                  <span className="flex h-3 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800" role="img" aria-label={`居場所型${mo.ibasho}回、親子が集まる場${mo.oyako}回`}>
                    <span className="bg-amber-400" style={{ width: `${(mo.ibasho / maxMonth) * 100}%` }} />
                    <span className="bg-sky-400" style={{ width: `${(mo.oyako / maxMonth) * 100}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums">{sum}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {top.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">主催団体（掲載の多い順・上位{top.length}）</h3>
          <ul className="grid gap-x-6 gap-y-0.5 text-sm md:grid-cols-2">
            {top.map((o) => (
              <li key={o.name} className="flex justify-between gap-3">
                <span className="truncate">{o.name}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{o.count}回</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        数えているのは「CiDAO に掲載された開催日」です。実際に開催された回数や参加者数を確かめた数字ではありません（中止・延期を含む可能性があります）。
        目印は、題名・主催名からの自動判定と、人が確認したもの（{summary.checked}／{summary.total}回）からなります。
      </p>
    </section>
  )
}
