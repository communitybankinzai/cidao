import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { Avatar } from '@/components/ui/avatar'
import { ReplyForm } from './_components/ReplyForm'

export const dynamic = 'force-dynamic'

type InquiryRow = {
  id: string
  to_member_id: string
  from_member_id: string
  message: string
  reply_to_inquiry_id: string | null
  proposal_id: string | null
  read_at: string | null
  created_at: string
}

type MemberLite = {
  id: string
  display_name: string
  avatar_url: string | null
}

/**
 * 届いた声がけ受信箱。
 * 自分が当事者のスレッド（ルート声がけ＋返信）を新着順に表示し、
 * このページを開いた時点で自分宛の未読を既読化する（service_role 経由）。
 */
export default async function InboxPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/me/inbox')

  // RLS: 自分が from か to の行のみ返る
  const { data: rows } = await supabase
    .from('talent_inquiries')
    .select('id, to_member_id, from_member_id, message, reply_to_inquiry_id, proposal_id, read_at, created_at')
    .order('created_at', { ascending: true })
    .limit(500)

  const inquiries: InquiryRow[] = rows ?? []

  // 提案への「大賛成」を起点にしたスレッドは、どの提案の話か分かるようにする
  const proposalIds = Array.from(
    new Set(inquiries.map((r) => r.proposal_id).filter((v): v is string => !!v))
  )
  const { data: proposalRows } = proposalIds.length > 0
    ? await supabase.from('proposals').select('id, title').in('id', proposalIds)
    : { data: [] }
  const proposalTitleOf = new Map<string, string>(
    (proposalRows ?? []).map((p) => [p.id, p.title])
  )

  // 相手メンバーの表示情報
  const otherIds = Array.from(new Set(
    inquiries.flatMap((r) => [r.from_member_id, r.to_member_id]).filter((id) => id !== user.id)
  ))
  const { data: memberRows } = otherIds.length > 0
    ? await supabase.from('members').select('id, display_name, avatar_url').in('id', otherIds)
    : { data: [] }
  const memberOf = new Map<string, MemberLite>((memberRows ?? []).map((m) => [m.id, m]))

  // スレッド化：ルート（reply_to null）ごとに返信をぶら下げ、最終更新の新しい順
  const roots = inquiries.filter((r) => r.reply_to_inquiry_id === null)
  const repliesOf = new Map<string, InquiryRow[]>()
  for (const r of inquiries) {
    if (!r.reply_to_inquiry_id) continue
    const list = repliesOf.get(r.reply_to_inquiry_id) ?? []
    list.push(r)
    repliesOf.set(r.reply_to_inquiry_id, list)
  }
  const threads = roots
    .map((root) => {
      const replies = repliesOf.get(root.id) ?? []
      const all = [root, ...replies]
      const last = all[all.length - 1]
      const unreadCount = all.filter((m) => m.to_member_id === user.id && !m.read_at).length
      const otherMemberId = root.from_member_id === user.id ? root.to_member_id : root.from_member_id
      return { root, replies, last, unreadCount, otherMemberId }
    })
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))

  const totalUnread = threads.reduce((n, t) => n + t.unreadCount, 0)

  // このページを開いた = 既読。read_at の UPDATE は受信者に RLS 開放していないため
  // service_role で行う（best-effort、失敗しても表示は成立する）
  if (totalUnread > 0) {
    try {
      const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      if (supaUrl && serviceKey) {
        const admin = createSupabaseClient(supaUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        await admin
          .from('talent_inquiries')
          .update({ read_at: new Date().toISOString() })
          .eq('to_member_id', user.id)
          .is('read_at', null)
      }
    } catch {
      // best-effort
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/me" className="hover:underline">← マイページ</Link>
        </nav>

        <header className="space-y-2">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">受信箱</p>
          <h1 className="text-2xl font-serif font-bold text-slate-900 dark:text-slate-100">
            📥 届いた声がけ
          </h1>
          <p className="text-xs text-slate-500">
            登録メンバーのプロフィールを見た人からの「活動の声がけ」と、そのやり取りの一覧です。
            ここから直接返信できます（相手にはベル通知とメールで届きます）。
          </p>
        </header>

        {threads.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center space-y-3">
            <p className="text-sm text-slate-500">まだ声がけはありません</p>
            <p className="text-xs text-slate-400">
              <Link href="/me/pr" className="underline">公開PR</Link> を充実させると、
              団体や主催者から声がかかる可能性が高まります。
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {threads.map(({ root, replies, unreadCount, otherMemberId }) => {
              const other = memberOf.get(otherMemberId)
              const otherName = other?.display_name ?? '（退会したメンバー）'
              return (
                <li
                  key={root.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 md:p-5 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar src={other?.avatar_url ?? null} name={otherName} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/talent/${otherMemberId}`}
                        className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:underline"
                      >
                        {otherName}
                      </Link>
                      <p className="text-[10px] text-slate-400">
                        {root.from_member_id === user.id ? 'あなたから声がけ' : 'あなたへの声がけ'}
                        {' · '}
                        {new Date(root.created_at).toLocaleString('ja-JP')}
                      </p>
                      {root.proposal_id && (
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                          提案「
                          <Link href={`/proposals/${root.proposal_id}`} className="underline">
                            {proposalTitleOf.get(root.proposal_id) ?? '（削除された提案）'}
                          </Link>
                          」について
                        </p>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-semibold">
                        未読 {unreadCount}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {[root, ...replies].map((m) => {
                      const mine = m.from_member_id === user.id
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                              mine
                                ? 'bg-emerald-50 dark:bg-emerald-950 text-slate-800 dark:text-slate-200'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {m.message}
                            <span className="block text-[10px] text-slate-400 mt-1 text-right">
                              {mine ? 'あなた' : otherName} · {new Date(m.created_at).toLocaleString('ja-JP')}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {other ? (
                    <ReplyForm rootInquiryId={root.id} otherName={otherName} />
                  ) : (
                    <p className="text-[10px] text-slate-400">相手が退会しているため返信できません</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
