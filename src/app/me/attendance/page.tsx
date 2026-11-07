import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { childPlaceLabel } from '@/lib/child-place'
import { AttendanceQuickForm } from '@/app/events/_components/AttendanceQuickForm'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string | null
  child_place: 'ibasho' | 'oyako' | null
  attendee_count: number | null
}

const dateFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 開催後の参加者数のお願い（/api/cron/attendance-ask の通知の行き先）。
// 自分が登録した「子どもの居場所」の催しのうち、終わったものを並べ、その場で人数を入れられる。
export default async function AttendancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/me/attendance')
  const { data: isAdmin } = await supabase.rpc('is_admin')

  // 自分が代表・役員をしている団体
  const { data: mem } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('member_id', user.id)
    .eq('status', 'confirmed')
    .in('role', ['representative', 'officer'])
    .is('left_at', null)
  const orgIds = ((mem ?? []) as { org_id: string }[]).map((m) => m.org_id).filter((id) => UUID_RE.test(id))

  // 自分が主催（登録）した、または写真を投稿した催し。団体主催は代表・役員の団体のもの
  const conds = [`and(organizer_type.eq.member,organizer_id.eq.${user.id})`, `submitter_member_id.eq.${user.id}`]
  if (orgIds.length) conds.push(`and(organizer_type.eq.org,organizer_id.in.(${orgIds.join(',')}))`)

  const { data } = await supabase
    .from('events')
    .select('id, title, start_at, end_at, location, child_place, attendee_count')
    .eq('status', 'open')
    .not('child_place', 'is', null)
    .lt('end_at', new Date().toISOString())
    .or(conds.join(','))
    .order('start_at', { ascending: false })
    .limit(200)
  const rows = (data ?? []) as Row[]
  const pending = rows.filter((r) => r.attendee_count === null)
  const done = rows.filter((r) => r.attendee_count !== null).slice(0, 10)

  return (
    <PageShell feature="events" width="narrow">
      <PageHeader
        feature="events"
        title="参加者数のお願い"
        description="開かれた「子どもの居場所」の催しに、実際に来た人数を入れてください。「こどもの居場所カレンダー」の実績の根拠になります。"
      />

      <section className="mb-6 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed dark:border-amber-900 dark:bg-amber-950/30">
        <p>来た人数（スタッフを除く目安で構いません）を入れて「保存」を押してください。</p>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          分からない催しは空のままで大丈夫です。空は「0人」ではなく「不明」と数えます。入れ間違えたら、数を直して保存し直せます（空にして保存すると未報告に戻ります）。
        </p>
      </section>

      <section aria-labelledby="attendance-pending" className="mb-8">
        <h2 id="attendance-pending" className="mb-2 text-base font-semibold">人数がまだの催し（{pending.length}件）</h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border bg-white p-4 text-center text-sm text-slate-500 dark:bg-slate-900">いま、人数をお願いしたい催しはありません。ありがとうございます。</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <RowItem key={r.id} r={r} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="attendance-done" className="mb-8">
          <h2 id="attendance-done" className="mb-2 text-base font-semibold">最近入れた催し（直近{done.length}件）</h2>
          <ul className="space-y-2">
            {done.map((r) => (
              <RowItem key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <Link href="/events/kodomo" className="underline">こどもの居場所カレンダー</Link>
        {isAdmin ? <>（運営は、全体の根拠の一覧から人数を入れられます：<Link href="/events/kodomo#evidence" className="underline">根拠の一覧</Link>）</> : null}
      </p>
    </PageShell>
  )
}

function RowItem({ r }: { r: Row }) {
  return (
    <li className="rounded-lg border bg-white p-3 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/events/${r.id}`} className="text-sm font-medium underline-offset-2 hover:underline">{r.title}</Link>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {dateFmt.format(new Date(r.start_at))}
            {r.location ? `・${r.location}` : ''}
            {r.child_place ? `・${childPlaceLabel(r.child_place)}` : ''}
          </p>
        </div>
        <AttendanceQuickForm eventId={r.id} initial={r.attendee_count} title={r.title} />
      </div>
    </li>
  )
}
