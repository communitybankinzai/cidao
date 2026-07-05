import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'

// 受付履歴（直近90日）。権限は受付モードと同じ（承認済みメンバー or 管理者）。
export default async function ReceptionHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/orgs/${id}/reception/history`)

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

  const from = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from('checkins')
    .select(
      'id, purpose, created_at, members!checkins_member_id_fkey(display_name), scanned:members!checkins_scanned_by_fkey(display_name), events(title)',
    )
    .eq('org_id', id)
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .limit(1000)

  type Row = {
    id: string
    memberName: string
    label: string
    operator: string
    createdAt: string
  }
  const items: Row[] = (rows ?? []).map((r) => {
    const m = (Array.isArray(r.members) ? r.members[0] : r.members) as { display_name: string } | null
    const s = (Array.isArray(r.scanned) ? r.scanned[0] : r.scanned) as { display_name: string } | null
    const ev = (Array.isArray(r.events) ? r.events[0] : r.events) as { title: string } | null
    return {
      id: r.id,
      memberName: m?.display_name ?? '匿名',
      label: ev?.title ?? r.purpose ?? '受付',
      operator: s?.display_name ?? '-',
      createdAt: r.created_at,
    }
  })

  // 日付ごとにグループ化（JST）
  const groups = new Map<string, Row[]>()
  for (const it of items) {
    const d = new Date(it.createdAt).toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    })
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(it)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href={`/orgs/${id}`} className="hover:underline">← {org.name}</Link>
          <Link href={`/orgs/${id}/reception`} className="hover:underline">受付モード</Link>
        </nav>

        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Reception History</p>
            <h1 className="text-2xl font-serif font-bold">受付履歴</h1>
            <p className="text-xs text-slate-500">直近90日 · {items.length}件</p>
          </div>
          <a href={`/orgs/${id}/reception/csv`} download>
            <Button size="sm" variant="outline">CSV ダウンロード</Button>
          </a>
        </header>

        {items.length === 0 ? (
          <p className="text-slate-400 text-center py-12">受付記録はまだありません</p>
        ) : (
          <div className="space-y-5">
            {[...groups.entries()].map(([date, list]) => (
              <section key={date} className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-2">
                <h2 className="text-sm font-semibold">{date}（{list.length}件）</h2>
                <ul className="space-y-1">
                  {list.map((it) => (
                    <li key={it.id} className="flex justify-between items-baseline gap-3 text-sm border-l-2 border-emerald-400 pl-3 py-0.5">
                      <span className="truncate">
                        {it.memberName}
                        <span className="ml-2 text-[10px] text-slate-400">{it.label} · 受付: {it.operator}</span>
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {new Date(it.createdAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
