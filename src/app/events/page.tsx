import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { buildCells, fetchWindow, parseYm, ymdInJst } from '@/lib/events-calendar'
import { tagKinds } from '@/lib/child-place'
import { parsePlaceTag } from '@/lib/senior-place'
import EventsBrowser, { type EventRow, type OrgInfo } from './_components/EventsBrowser'

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ ym?: string; view?: string; tag?: string }> }) {
  const sp = await searchParams
  const { y, m } = parseYm(sp.ym)
  const view: 'calendar' | 'list' = sp.view === 'list' ? 'list' : 'calendar'
  // 居場所での絞り込み（?tag=kodomo|ibasho|oyako＝子ども、senior＝高齢者）。知らない値は絞り込みなし
  const tag = parsePlaceTag(sp.tag)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 一覧に「編集」リンクを出すかの判定に使う。厳密な編集権限（団体役員・連絡先メール一致）は
  // 編集ページ側で判定されるため、ここでは1件ずつ RPC を呼ばずに済む条件だけを見る。
  const { data: isAdmin } = user ? await supabase.rpc('is_admin') : { data: false }

  // リスト表示は「選択月から6ヶ月先」まで連続表示するため取得範囲を広げる。カレンダー表示は単月のまま。
  const { fetchStart, fetchEnd } = fetchWindow(y, m, view)

  let eventsQuery = supabase
    .from('events')
    .select('id, title, description, category, start_at, end_at, location, online_flag, organizer_type, organizer_id, organizer_name_text, flyer_image_url, child_place, senior_place, cafe_place')
    .neq('status', 'draft')
    .lt('start_at', fetchEnd.toISOString())
    .gt('end_at', fetchStart.toISOString())
  if (tag === 'senior') eventsQuery = eventsQuery.eq('senior_place', true)
  else if (tag === 'cafe') eventsQuery = eventsQuery.eq('cafe_place', true)
  else if (tag) eventsQuery = eventsQuery.in('child_place', tagKinds(tag))
  const { data: events } = await eventsQuery.order('start_at', { ascending: true })

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
    <PageShell feature="events" width="default">
      <PageHeader feature="events"
        title="印西市のイベント・活動カレンダー"
        description={
          <>
            印西市内で活動する<strong className="text-slate-800 dark:text-slate-200">市民団体・企業・行政・個人</strong>が主催するイベントをまとめて掲載
            {!user && (
              <>
                {' '}
                <strong className="text-slate-800 dark:text-slate-200">閲覧に登録は不要です。</strong>
                参加の申し込みやイベントの掲載をしたい方は{' '}
                <Link href="/login" className="underline hover:text-slate-900 dark:hover:text-slate-100">ログイン</Link>
                してください（LINEでワンタップ・無料）。
              </>
            )}
          </>
        }
        actions={
          user && (
            <Link href="/events/new">
              <Button>イベント登録</Button>
            </Link>
          )
        }
      />

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
      />
    </PageShell>
  )
}
