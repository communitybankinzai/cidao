import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { buildCells, fetchWindow, parseYm, ymdInJst } from '@/lib/events-calendar'
import { CHILD_PLACE_KINDS, parseChildPlaceTag, tagKinds, type ChildPlaceSummary } from '@/lib/child-place'
import { loadChildPlaceReport } from '@/lib/child-place-data'
import type { EvidenceRow } from '@/lib/child-place-evidence'
import EventsBrowser, { type EventRow, type OrgInfo } from '../_components/EventsBrowser'
import { PrintButton } from './_components/PrintButton'

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

  const orgIds = Array.from(new Set(rows.filter((r) => r.organizer_type === 'org').map((r) => r.organizer_id)))
  const { data: orgList } = orgIds.length
    ? await supabase.from('organizations').select('id, name, type, legal_form, logo_url').in('id', orgIds)
    : { data: [] as OrgInfo[] }
  const orgInfo: Record<string, OrgInfo> = {}
  for (const o of (orgList ?? []) as OrgInfo[]) orgInfo[o.id] = o

  // ---- 実績（掲載の状況・根拠の一覧）。CSV と同じ元データ
  const report = await loadChildPlaceReport(supabase)
  const cells = buildCells(y, m)
  const today = ymdInJst(report.generatedAt)

  return (
    <PageShell feature="events" width="default">
      <PageHeader
        feature="events"
        title="こどもの居場所カレンダー"
        description={DESCRIPTION}
        actions={
          <Link href="/events" className="text-sm underline text-slate-600 dark:text-slate-300 print:hidden">
            すべてのイベントを見る →
          </Link>
        }
      />

      <PurposeCard />
      <SummaryCard summary={report.summary} evidenceCount={report.evidence.length} generatedAt={report.generatedAt} />

      <div className="print:hidden">
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
      </div>

      <EvidenceSection evidence={report.evidence} isAdmin={!!isAdmin} />

      <p className="mt-6 text-xs text-slate-500 dark:text-slate-400 print:hidden">
        主催の方へ：イベントの{' '}
        <Link href="/events/new" className="underline">登録</Link>
        {' '}・編集の画面にある「子どもの居場所」の欄で、このカレンダーに載せるかどうかを選べます。分からなければ「自動」のままで構いません。
        開催後は、編集の画面で参加者数を入れていただくと、この実績に反映されます。
      </p>
    </PageShell>
  )
}

// ===========================
// 趣旨：居場所の見える化
// ===========================
function PurposeCard() {
  return (
    <section aria-labelledby="kodomo-purpose" className="mb-6 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed dark:border-amber-900 dark:bg-amber-950/30 print:break-inside-avoid">
      <h2 id="kodomo-purpose" className="text-base font-semibold">居場所の見える化</h2>
      <p>
        子どもや親子が安心して過ごせる場（子ども食堂・プレーパーク・おやこカフェ・図書館のおはなし会など）は、
        開く団体や場所ごとに情報が分かれていて、必要な人に届きにくいことがあります。
      </p>
      <p>
        このページは、CiDAO に載っている印西市内の催しのうち、子どもの居場所にあたるものを1つのカレンダーに集め、
        <strong>いつ・どこで・だれが開いているか</strong>が見えるようにするものです。あわせて、催しの回数・団体の数・参加者数を、
        <strong>1件ずつの根拠つき</strong>で公開します（下の「根拠の一覧」。CSV で保存、印刷もできます）。
      </p>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        運営：Community Bank Inzai（印西市市民活動団体・登録番号 08-001）。市民が運営する情報提供で、印西市の公式情報ではありません。
      </p>
    </section>
  )
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

// ===========================
// 掲載の状況（実績の数字）と、その数え方
// ===========================
function SummaryCard({ summary, evidenceCount, generatedAt }: { summary: ChildPlaceSummary; evidenceCount: number; generatedAt: Date }) {
  const maxMonth = Math.max(1, ...summary.months.map((mo) => mo.ibasho + mo.oyako))
  const top = summary.organizerList.slice(0, 10)
  const a = summary.attendance
  const range = summary.firstYm && summary.lastYm ? `${ymLabel(summary.firstYm)}〜${ymLabel(summary.lastYm)}` : undefined

  const tiles: { label: string; value: string; unit: string; note?: string }[] = [
    { label: '掲載された開催', value: String(summary.total), unit: '回', note: range },
    { label: 'うち開催日が過ぎたもの', value: String(summary.past), unit: '回' },
    { label: 'これから', value: String(summary.upcoming), unit: '回' },
    { label: '主催団体', value: String(summary.organizers), unit: '団体', note: '表記ゆれは同じ団体として数えています' },
    {
      label: '参加者数（報告のあった回の合計）',
      value: a.reported > 0 ? String(a.total) : '—',
      unit: a.reported > 0 ? '人' : '',
      note:
        a.reported > 0
          ? `報告 ${a.reported}回／開催済み ${a.past}回・1回あたり平均 ${a.average}人`
          : `まだ報告がありません（開催済み ${a.past}回）`,
    },
  ]

  return (
    <section aria-labelledby="kodomo-summary" className="mb-6 space-y-4 rounded-lg border bg-white p-4 dark:bg-slate-900 print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kodomo-summary" className="text-base font-semibold">掲載の状況</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{ymdInJst(generatedAt)} 時点</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-slate-200 p-3 dark:border-slate-700">
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t.label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">
              {t.value}
              {t.unit && <span className="ml-1 text-sm font-normal text-slate-500">{t.unit}</span>}
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

      <div>
        <h3 className="mb-1.5 text-sm font-medium">数字の数え方</h3>
        <dl className="space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          <div>
            <dt className="inline font-medium text-slate-700 dark:text-slate-200">開催：</dt>
            <dd className="inline">
              CiDAO に載っている開催日の数です（1日の催しを1回と数えます）。実際に開催されたことを確かめた数字ではなく、
              中止・延期を含む可能性があります。同じ催しが別の情報源から重複して載っている場合は、二重に数えています。
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-700 dark:text-slate-200">主催団体：</dt>
            <dd className="inline">主催名の表記ゆれ（「NPO法人」の有無・空白など）を同じ団体として数えた数です。</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-700 dark:text-slate-200">参加者数：</dt>
            <dd className="inline">
              開催後に主催者または運営が報告した人数で、「報告のあった回」だけを足しています。報告のない回は
              <strong>「不明」</strong>で、0人とは数えていません。
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-700 dark:text-slate-200">目印：</dt>
            <dd className="inline">
              題名・主催名からの自動判定と、人が確認したもの（{summary.checked}／{summary.total}回）からなります。
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs print:hidden">
          <a href="#evidence" className="underline">1件ずつの根拠（{evidenceCount}件）を見る ↓</a>
        </p>
      </div>
    </section>
  )
}

// ===========================
// 根拠の一覧（1件ずつ）。数字を確かめられるようにする
// ===========================
function EvidenceSection({ evidence, isAdmin }: { evidence: EvidenceRow[]; isAdmin: boolean }) {
  return (
    <section id="evidence" aria-labelledby="kodomo-evidence" className="mt-8 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="kodomo-evidence" className="text-base font-semibold">根拠の一覧（{evidence.length}件）</h2>
        <div className="flex gap-2">
          {/* ファイルのダウンロード（route handler）なので、画面遷移の Link ではなく通常のリンクにする */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/events/kodomo/csv"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 print:hidden"
          >
            CSV で保存
          </a>
          <PrintButton />
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        上の数字は、ここに並べた1件ずつを数えたものです。催しの名前から CiDAO のページへ、「出典」から元の情報（主催者の投稿・市のカレンダーなど）へ移れます。
      </p>

      <div className="overflow-x-auto rounded-lg border bg-white dark:bg-slate-900">
        <table className="w-full min-w-[40rem] text-xs">
          <thead className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">日時</th>
              <th scope="col" className="px-2 py-2 font-medium">催し</th>
              <th scope="col" className="px-2 py-2 font-medium">主催</th>
              <th scope="col" className="px-2 py-2 font-medium">目印</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">参加者数</th>
              <th scope="col" className="px-2 py-2 font-medium">出典</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {evidence.map((r) => (
              <tr key={r.id} className={r.held ? '' : 'text-slate-500 dark:text-slate-400'}>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.date} {r.time}</td>
                <td className="px-2 py-1.5">
                  <Link href={r.pagePath} className="underline-offset-2 hover:underline">{r.title}</Link>
                </td>
                <td className="px-2 py-1.5">{r.organizer}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{r.kindLabel}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  {!r.held ? (
                    <span className="text-slate-400">これから</span>
                  ) : r.attendee !== null ? (
                    <>
                      {r.attendee}人
                      {r.attendeeSource && <span className="ml-1 text-[10px] text-slate-400">（{r.attendeeSource}）</span>}
                    </>
                  ) : isAdmin ? (
                    <Link href={`/events/${r.id}/edit`} className="text-amber-700 underline print:hidden dark:text-amber-300">人数を入れる</Link>
                  ) : (
                    <span className="text-slate-400">不明</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <span className="text-slate-500 dark:text-slate-400">{r.sourceKind}</span>
                  {r.sourceUrl ? (
                    <>
                      {' '}
                      <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">出典を見る</a>
                    </>
                  ) : (
                    <span className="ml-1 text-[10px] text-slate-400">（出典の記載なし）</span>
                  )}
                </td>
              </tr>
            ))}
            {evidence.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-500">まだ目印のついた催しがありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
