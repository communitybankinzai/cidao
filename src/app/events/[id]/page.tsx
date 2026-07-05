import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { categoryLabel } from '@/lib/categories'
import { canUserEditEvent } from '@/lib/event-permissions'
import { joinEvent, leaveEvent, claimEvent, manageParticipant } from '../actions'

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: event } = await supabase.from('events').select('*').eq('id', id).single()
  if (!event) notFound()

  const { data: organizerOrg } = event.organizer_type === 'org'
    ? await supabase.from('organizations').select('id, name').eq('id', event.organizer_id).maybeSingle()
    : { data: null }

  const canEdit = user
    ? await canUserEditEvent(supabase, event, user.id, user.email ?? null)
    : false

  const { data: participants } = await supabase
    .from('event_participants')
    .select('member_id, role, attended, members(display_name)')
    .eq('event_id', id)

  const myParticipation = user ? participants?.find((p) => p.member_id === user.id) : null
  const isOrganizer = myParticipation?.role === 'organizer'
  const counts = {
    organizer: participants?.filter((p) => p.role === 'organizer').length ?? 0,
    staff: participants?.filter((p) => p.role === 'staff').length ?? 0,
    participant: participants?.filter((p) => p.role === 'participant').length ?? 0,
  }
  const isFull = event.capacity != null && counts.participant >= event.capacity

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/events" className="hover:underline">← イベント一覧</Link></nav>

        {sp.error === 'forbidden' && (
          <div className="border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-950/30 px-4 py-2 rounded text-sm text-rose-800 dark:text-rose-200">
            このイベントを編集する権限がありません（主催者本人・主催団体の役員・関連団体の連絡先メール一致のいずれかが必要）。
          </div>
        )}

        <header className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex gap-2 text-xs flex-wrap">
              <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(event.category)}</span>
              {event.online_flag && <span className="px-2 py-1 bg-sky-100 dark:bg-sky-900 rounded">オンライン</span>}
              <span className="px-2 py-1 bg-amber-100 dark:bg-amber-950 rounded">{event.status}</span>
            </div>
            {canEdit && (
              <Link href={`/events/${id}/edit`}>
                <Button variant="outline" size="sm">編集</Button>
              </Link>
            )}
          </div>
          <h1 className="text-3xl font-serif font-bold">{event.title}</h1>
          <p className="text-sm text-slate-500">
            {new Date(event.start_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 〜 {new Date(event.end_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
          </p>
        </header>

        {event.flyer_image_url && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.flyer_image_url}
              alt={`${event.title} のチラシ`}
              className="max-h-[600px] max-w-full object-contain rounded"
            />
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <p className="text-sm text-slate-500 mb-3">
            主催:{' '}
            {organizerOrg ? (
              <Link href={`/orgs/${organizerOrg.id}`} className="text-slate-900 dark:text-slate-100 hover:underline">{organizerOrg.name}</Link>
            ) : event.organizer_name_text ? (
              <span className="text-slate-900 dark:text-slate-100">{event.organizer_name_text}<span className="ml-1 text-xs text-slate-400">（代理登録）</span></span>
            ) : (
              <span>個人主催</span>
            )}
          </p>
          <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">{event.description}</p>
          {event.location && <p className="mt-3 text-sm">📍 {event.location}</p>}
          {event.fee != null && <p className="text-sm">参加費: {event.fee} 円</p>}
          {event.capacity != null && <p className="text-sm">定員: {event.capacity} 名（現在 {counts.participant} 名）</p>}
          {(event.website_url || event.form_url) && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {event.website_url && (
                <a href={event.website_url} target="_blank" rel="noopener noreferrer" className="text-slate-700 dark:text-slate-300 underline hover:text-slate-900 dark:hover:text-slate-100">
                  🔗 サイトを見る
                </a>
              )}
              {event.form_url && (
                <a href={event.form_url} target="_blank" rel="noopener noreferrer" className="text-slate-700 dark:text-slate-300 underline hover:text-slate-900 dark:hover:text-slate-100">
                  📝 申込フォーム
                </a>
              )}
            </div>
          )}
        </div>

        {event.external_source && (
          <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-2">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">情報提供</h2>
            {event.submitter_member_id ? (
              event.submitter_member_id === user?.id ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-300">✅ あなたがこのイベント情報の提供者です（貢献度 +10pt 付与済み）。上の「編集」から内容を修正できます。</p>
              ) : (
                <p className="text-sm text-slate-500">情報提供者が登録済みです。</p>
              )
            ) : !user ? (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-400">この写真（チラシ）を投稿したのがあなたなら、ログインして申告すると内容を編集できるようになり、情報提供として貢献度ポイント（+10pt）が付きます。</p>
                <Link href={`/login?next=/events/${id}`}><Button variant="outline" size="sm">ログインして申告</Button></Link>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-400">この写真（チラシ）を投稿したのがあなたなら、申告すると内容を編集できるようになり、情報提供として貢献度ポイント（+10pt）が付きます。</p>
                <form action={async () => { 'use server'; await claimEvent(id) }}>
                  <Button type="submit" variant="outline" size="sm">これは私が投稿しました</Button>
                </form>
              </>
            )}
          </section>
        )}

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">参加</h2>
          {!user ? (
            <Link href={`/login?next=/events/${id}`}><Button>ログインして参加</Button></Link>
          ) : myParticipation ? (
            <div className="flex gap-3 items-center">
              <span className="text-sm">あなたは {myParticipation.role === 'organizer' ? '主催者' : myParticipation.role === 'staff' ? 'スタッフ' : '参加者'} として登録中</span>
              {!isOrganizer && (
                <form action={async () => { 'use server'; await leaveEvent(id) }}>
                  <Button type="submit" variant="outline" size="sm">キャンセル</Button>
                </form>
              )}
            </div>
          ) : isFull ? (
            <p className="text-sm text-slate-500">満員のため参加できません</p>
          ) : (
            <form action={async () => { 'use server'; await joinEvent(id) }}>
              <Button type="submit">参加する</Button>
            </form>
          )}
          <p className="text-xs text-slate-500">主催 {counts.organizer} / スタッフ {counts.staff} / 参加 {counts.participant}</p>
        </section>

        {canEdit && (participants?.length ?? 0) > 0 && (
          <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">出欠・役割の管理（主催者用）</h2>
            <p className="text-xs text-slate-500">出席をつけると、その人に役割に応じた貢献度ポイントが付きます（主催 40 / スタッフ 20 / 参加 5）。スタッフにしたい人は「スタッフで出席」を押してください。</p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {participants!.map((p) => {
                const m = Array.isArray(p.members) ? p.members[0] : p.members
                const name = (m as { display_name?: string } | null)?.display_name ?? '（名前未設定）'
                const roleLabel = p.role === 'organizer' ? '主催者' : p.role === 'staff' ? 'スタッフ' : '参加者'
                return (
                  <li key={p.member_id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                    <span className="text-sm">
                      {name}
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{roleLabel}</span>
                      {p.attended && <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">✅ 出席</span>}
                    </span>
                    <span className="flex gap-1.5 flex-wrap">
                      {p.attended ? (
                        <form action={async () => { 'use server'; await manageParticipant(id, p.member_id, null, false) }}>
                          <Button type="submit" variant="outline" size="sm">出席取消</Button>
                        </form>
                      ) : p.role === 'organizer' ? (
                        <form action={async () => { 'use server'; await manageParticipant(id, p.member_id, null, true) }}>
                          <Button type="submit" size="sm">主催で出席 +40</Button>
                        </form>
                      ) : (
                        <>
                          <form action={async () => { 'use server'; await manageParticipant(id, p.member_id, 'participant', true) }}>
                            <Button type="submit" variant="outline" size="sm">参加で出席 +5</Button>
                          </form>
                          <form action={async () => { 'use server'; await manageParticipant(id, p.member_id, 'staff', true) }}>
                            <Button type="submit" size="sm">スタッフで出席 +20</Button>
                          </form>
                        </>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </article>
    </div>
  )
}
