import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  evaluateRequest,
  pickRule,
  ROLE_LABEL,
  STATUS_LABEL,
  type ApprovalRequest,
  type ApprovalRule,
  type ApprovalStamp,
  type Officer,
} from '@/lib/approval'

// 電子決裁の一覧。CBI 役員（会長・副会長・会計・監査役）のみ利用できる。
// 決裁基準（必要な承認者・定足数・期限）は approval_rules から読む。

export const dynamic = 'force-dynamic'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  withdrawn: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  draft: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
}

export default async function ApprovalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/approvals')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const service = createSupabaseAdmin(url, key, { auth: { persistSession: false } })

  const { data: meRow } = await service
    .from('members')
    .select('id, display_name, officer_role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!meRow?.officer_role) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
        <div className="max-w-xl mx-auto space-y-4 text-center py-20">
          <h1 className="text-2xl font-serif font-bold">🔏 電子決裁</h1>
          <p className="text-sm text-slate-500">
            このページは CBI の役員（会長・副会長・会計・監査役）のみ利用できます。<br />
            役員の方でこの表示が出る場合は、役員区分がまだ付与されていません。管理担当（中司）へ連絡してください。
          </p>
          <p><Link href="/" className="text-sm text-blue-600 hover:underline">← ホームへ戻る</Link></p>
        </div>
      </div>
    )
  }
  const me: Officer = {
    id: meRow.id as string,
    display_name: meRow.display_name as string,
    officer_role: meRow.officer_role as Officer['officer_role'],
  }

  const [{ data: reqRows }, { data: ruleRows }, { data: officerRows }] = await Promise.all([
    service.from('approval_requests').select('*').order('created_at', { ascending: false }).limit(200),
    service.from('approval_rules').select('*'),
    service.from('members').select('id, display_name, officer_role').not('officer_role', 'is', null).is('deleted_at', null),
  ])
  const requests = (reqRows ?? []) as ApprovalRequest[]
  const rules = (ruleRows ?? []) as ApprovalRule[]
  const officers = (officerRows ?? []) as Officer[]
  const officerName = new Map(officers.map((o) => [o.id, o.display_name]))

  const { data: stampRows } = requests.length
    ? await service.from('approval_stamps').select('*').in('request_id', requests.map((r) => r.id))
    : { data: [] }
  const stamps = (stampRows ?? []) as ApprovalStamp[]

  // 各案件の判定（区分の基準が未登録の案件は評価なしで表示だけする）
  const evaluated = requests.map((r) => {
    const rule = pickRule(rules, r.category, r.created_at)
    const ev = rule ? evaluateRequest(r, rule, officers, stamps.filter((s) => s.request_id === r.id)) : null
    return { request: r, rule, ev }
  })

  const pending = evaluated.filter((x) => x.request.status === 'pending')
  // あなたの押印待ち: 決裁中で、自分が意思表示でき、まだ有効な押印をしていないもの
  const myTurn = pending.filter((x) => {
    if (!x.ev) return false
    if (!x.ev.stampableOfficers.some((o) => o.id === me.id)) return false
    return !x.ev.intents.get(me.id)?.stamp
  })
  const mine = evaluated.filter((x) => x.request.requested_by === me.id)
  const past = evaluated.filter((x) => x.request.status !== 'pending')

  const catLabel = (r: ApprovalRequest, rule: ApprovalRule | null) => rule?.label ?? r.category

  const Row = ({ request: r, rule, ev }: (typeof evaluated)[number]) => (
    <li>
      <Link
        href={`/admin/approvals/${r.id}`}
        className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-slate-400 dark:hover:border-slate-600 transition"
      >
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_BADGE[r.status] ?? ''}`}>
            {STATUS_LABEL[r.status]}
          </span>
          {ev?.overdue && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">
              期限超過
            </span>
          )}
          <span className="text-[11px] text-slate-500">{catLabel(r, rule)}</span>
          {r.category === 'expense' && r.amount !== null && (
            <span className="text-[11px] text-slate-500">{r.amount.toLocaleString('ja-JP')}円</span>
          )}
        </div>
        <p className="font-semibold">{r.title}</p>
        <p className="text-xs text-slate-500 mt-1">
          起案: {officerName.get(r.requested_by) ?? '（不明）'} ／ {fmtDate(r.created_at)}
          {ev && r.status === 'pending' && (
            <>
              {' ／ '}期限 {fmtDate(ev.deadlineAt)}
              {' ／ '}意思表示 {ev.expressedCount}/{ev.quorumBase} 名（承認 {ev.approveCount}・却下 {ev.rejectCount}・保留 {ev.holdCount}）
            </>
          )}
        </p>
      </Link>
    </li>
  )

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">CBI 役員</p>
          <h1 className="text-3xl font-serif font-bold">🔏 電子決裁</h1>
          <p className="text-sm text-slate-500">
            {me.display_name} さん（{ROLE_LABEL[me.officer_role]}）としてログイン中。
            {me.officer_role === 'auditor'
              ? ' 監査役は全件と履歴を閲覧できます（押印はしません）。'
              : ' 役員会の決議を電磁的方法で行います（決裁規程に基づく）。'}
          </p>
        </header>

        {me.officer_role !== 'auditor' && (
          <p>
            <Link
              href="/admin/approvals/new"
              className="inline-block px-5 py-2.5 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              ＋ 新しく起案する
            </Link>
          </p>
        )}

        {me.officer_role !== 'auditor' && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">🖊 あなたの押印待ち（{myTurn.length}件）</h2>
            {myTurn.length === 0 ? (
              <p className="text-sm text-slate-500">押印待ちの案件はありません。</p>
            ) : (
              <ul className="space-y-2">{myTurn.map((x) => <Row key={x.request.id} {...x} />)}</ul>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">📤 自分が起案した案件（{mine.length}件）</h2>
          {mine.length === 0 ? (
            <p className="text-sm text-slate-500">起案した案件はありません。</p>
          ) : (
            <ul className="space-y-2">{mine.map((x) => <Row key={x.request.id} {...x} />)}</ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">⏳ 決裁中の案件（全{pending.length}件）</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">決裁中の案件はありません。</p>
          ) : (
            <ul className="space-y-2">{pending.map((x) => <Row key={x.request.id} {...x} />)}</ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">📚 過去の決裁（{past.length}件）</h2>
          <p className="text-xs text-slate-500">
            承認・却下・取り下げの記録。押印の履歴は各案件の詳細から確認できます（記録は書き換えられません）。
          </p>
          {past.length === 0 ? (
            <p className="text-sm text-slate-500">過去の決裁はありません。</p>
          ) : (
            <ul className="space-y-2">{past.map((x) => <Row key={x.request.id} {...x} />)}</ul>
          )}
        </section>
      </div>
    </div>
  )
}
