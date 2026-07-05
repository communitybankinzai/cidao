import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ReceptionClient } from './_components/ReceptionClient'

// QR 受付モード。承認済みメンバー（または CiDAO 管理者）のみ。
// 会員証 QR（/talent/<member_id>）をカメラで読み取り、受付を記録する。
export default async function ReceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/orgs/${id}/reception`)

  const { data: org } = await supabase.from('organizations').select('id, name').eq('id', id).single()
  if (!org) notFound()

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) {
    const { data: mem } = await supabase
      .from('memberships')
      .select('status')
      .eq('org_id', id)
      .eq('member_id', user.id)
      .eq('status', 'confirmed')
      .is('left_at', null)
      .maybeSingle()
    if (!mem) redirect(`/orgs/${id}?error=forbidden`)
  }

  // 受付対象に選べるイベント：この団体の「昨日〜2週間先」のもの
  const now = Date.now()
  const from = new Date(now - 1 * 86_400_000).toISOString()
  const to = new Date(now + 14 * 86_400_000).toISOString()
  const { data: events } = await supabase
    .from('events')
    .select('id, title, start_at')
    .eq('organizer_type', 'org')
    .eq('organizer_id', id)
    .neq('status', 'draft')
    .gte('start_at', from)
    .lt('start_at', to)
    .order('start_at', { ascending: true })
    .limit(20)

  // 本日の受付履歴（RLS: 承認済みメンバーは閲覧可）
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { data: todayRows } = await supabase
    .from('checkins')
    .select('id, purpose, event_id, created_at, members!checkins_member_id_fkey(display_name)')
    .eq('org_id', id)
    .gte('created_at', todayStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(50)

  const initialCheckins = (todayRows ?? []).map((r) => {
    const m = (Array.isArray(r.members) ? r.members[0] : r.members) as { display_name: string } | null
    return {
      id: r.id,
      memberName: m?.display_name ?? '匿名',
      purpose: r.purpose,
      eventId: r.event_id,
      createdAt: r.created_at,
    }
  })

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href={`/orgs/${id}`} className="hover:underline">← {org.name} に戻る</Link>
          <Link href={`/orgs/${id}/reception/history`} className="hover:underline">受付履歴・CSV →</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Reception</p>
          <h1 className="text-2xl font-serif font-bold">受付モード</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{org.name}</p>
          <p className="text-xs text-slate-500">
            参加者の会員証 QR（トップページに表示）をカメラで読み取ると受付が記録されます。
            イベントを選んで受付すると出席として貢献度ポイントも付与されます。
          </p>
        </header>

        <ReceptionClient
          orgId={id}
          events={(events ?? []).map((e) => ({ id: e.id, title: e.title, startAt: e.start_at }))}
          initialCheckins={initialCheckins}
        />
      </div>
    </div>
  )
}
