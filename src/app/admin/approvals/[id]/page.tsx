import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  ACTION_LABEL,
  ATTACHMENT_BUCKET,
  evaluateRequest,
  pickRule,
  ROLE_LABEL,
  STATUS_LABEL,
  type ApprovalRequest,
  type ApprovalRule,
  type ApprovalStamp,
  type Officer,
} from '@/lib/approval'
import { EditBodyForm, StampControls, WithdrawButton } from '../_components/StampControls'

// 決裁案件の詳細。本文・押印状況（誰が押した／未押印）・押印ボタン・履歴。
// 利益相反の当事者と監査役には押印ボタンを出さない。

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

const ACTION_BADGE: Record<string, string> = {
  approve: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  reject: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  hold: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  revoke: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/admin/approvals/${id}`)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const service = createSupabaseAdmin(url, key, { auth: { persistSession: false } })

  const { data: meRow } = await service
    .from('members')
    .select('id, display_name, officer_role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!meRow?.officer_role) redirect('/admin/approvals')
  const me: Officer = {
    id: meRow.id as string,
    display_name: meRow.display_name as string,
    officer_role: meRow.officer_role as Officer['officer_role'],
  }

  const [{ data: reqRow }, { data: ruleRows }, { data: officerRows }, { data: stampRows }] = await Promise.all([
    service.from('approval_requests').select('*').eq('id', id).maybeSingle(),
    service.from('approval_rules').select('*'),
    service.from('members').select('id, display_name, officer_role').not('officer_role', 'is', null).is('deleted_at', null),
    service.from('approval_stamps').select('*').eq('request_id', id).order('stamped_at', { ascending: true }),
  ])
  if (!reqRow) notFound()
  const request = reqRow as ApprovalRequest
  const rules = (ruleRows ?? []) as ApprovalRule[]
  const officers = (officerRows ?? []) as Officer[]
  const stamps = (stampRows ?? []) as ApprovalStamp[]
  const officerById = new Map(officers.map((o) => [o.id, o]))

  const rule = pickRule(rules, request.category, request.created_at)
  const ev = rule ? evaluateRequest(request, rule, officers, stamps) : null

  const excluded = new Set(ev?.excludedIds ?? [])
  const requiredIds = new Set((ev?.requiredApprovers ?? []).map((o) => o.id))
  const iAmExcluded = excluded.has(me.id)
  const canStamp =
    request.status === 'pending' &&
    me.officer_role !== 'auditor' &&
    !iAmExcluded &&
    (ev?.stampableOfficers.some((o) => o.id === me.id) ?? false)
  const myIntent = ev?.intents.get(me.id)?.stamp?.action ?? null
  const isRequester = request.requested_by === me.id

  // 添付の署名付きURL（非公開バケット。役員のみこのページに到達できる）
  const attachments: { name: string; size: number; signedUrl: string | null }[] = []
  for (const a of request.attachments ?? []) {
    const { data: s } = await service.storage.from(ATTACHMENT_BUCKET).createSignedUrl(a.path, 3600)
    attachments.push({ name: a.name, size: a.size, signedUrl: s?.signedUrl ?? null })
  }

  const requesterName = officerById.get(request.requested_by)?.display_name ?? '（不明）'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/admin/approvals" className="hover:underline">← 電子決裁の一覧へ</Link>
        </nav>

        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE[request.status] ?? ''}`}>
              {STATUS_LABEL[request.status]}
            </span>
            {ev?.overdue && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">
                期限超過（自動では承認されません）
              </span>
            )}
            <span className="text-xs text-slate-500">{rule?.label ?? request.category}</span>
          </div>
          <h1 className="text-2xl font-serif font-bold">{request.title}</h1>
          <p className="text-xs text-slate-500">
            起案: {requesterName} ／ {fmtDate(request.created_at)}
            {ev && <>{' ／ '}決裁期限: {fmtDate(ev.deadlineAt)}</>}
            {request.decided_at && <>{' ／ '}決裁日時: {fmtDate(request.decided_at)}</>}
          </p>
        </header>

        {request.category === 'expense' && request.amount !== null && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <p className="text-sm"><b>金額:</b> {request.amount.toLocaleString('ja-JP')}円</p>
            {rule?.threshold_amount !== null && rule?.threshold_amount !== undefined && request.amount < rule.threshold_amount && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                ※ 基準額（{rule.threshold_amount.toLocaleString('ja-JP')}円）未満の支出です。予算外の支出などの理由で起案されています。
              </p>
            )}
          </section>
        )}

        {request.category === 'conflict_of_interest' && (
          <section className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4 space-y-1">
            <p className="text-sm font-semibold">⚖ 利益相反のある取引</p>
            <p className="text-sm">{request.conflict_note ?? '（関係の内容の記載なし）'}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              当事者: {Array.from(excluded).map((mid) => officerById.get(mid)?.display_name ?? '（不明）').join('、') || '—'}
              （承認に参加できません。残りの役員 {ev?.quorumBase ?? '—'} 名で決裁します）
            </p>
          </section>
        )}

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-500 mb-2">本文</h2>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{request.body}</div>
        </section>

        {attachments.length > 0 && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-500 mb-2">添付ファイル（役員のみ閲覧可・リンクは1時間有効）</h2>
            <ul className="space-y-1">
              {attachments.map((a, i) => (
                <li key={i} className="text-sm">
                  {a.signedUrl ? (
                    <a href={a.signedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      📎 {a.name}
                    </a>
                  ) : (
                    <span className="text-slate-400">📎 {a.name}（リンクを発行できませんでした）</span>
                  )}
                  <span className="text-xs text-slate-500 ml-2">{(a.size / 1024 / 1024).toFixed(1)}MB</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="text-lg font-semibold">🖊 押印状況</h2>
          {ev ? (
            <p className="text-xs text-slate-500">
              意思表示 {ev.expressedCount}/{ev.quorumBase} 名（承認 {ev.approveCount}・却下 {ev.rejectCount}・保留 {ev.holdCount}）
              ／ 定足数（過半数）{ev.quorumMet ? '成立' : '未成立'}
              ／ 必要な承認者: {ev.requiredApprovers.map((o) => `${ROLE_LABEL[o.officer_role]}（${o.display_name}）`).join('、') || '—'}
              {ev.requiredUnresolvable && <span className="text-red-600">（決裁権者を確保できない案件です。役員会で扱いを確認してください）</span>}
            </p>
          ) : (
            <p className="text-xs text-red-600">この区分の決裁基準が未登録のため、可否判定ができません。</p>
          )}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {officers.map((o) => {
              const intent = ev?.intents.get(o.id)
              const stamp = intent?.stamp ?? null
              const stale = intent?.staleStamp ?? null
              let statusNode
              if (o.officer_role === 'auditor') {
                statusNode = <span className="text-xs text-slate-500">閲覧のみ（監査役は押印しません）</span>
              } else if (excluded.has(o.id)) {
                statusNode = <span className="text-xs text-amber-700 dark:text-amber-400">当事者のため除外</span>
              } else if (stamp) {
                statusNode = (
                  <span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ACTION_BADGE[stamp.action] ?? ''}`}>
                      {ACTION_LABEL[stamp.action]}
                    </span>
                    <span className="text-xs text-slate-500 ml-2">{fmtDate(stamp.stamped_at)}</span>
                  </span>
                )
              } else if (stale) {
                statusNode = (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    無効（本文変更前の{ACTION_LABEL[stale.action]}・押し直しが必要）
                  </span>
                )
              } else {
                statusNode = <span className="text-xs text-slate-400">未押印</span>
              }
              return (
                <li key={o.id} className="py-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium min-w-[10rem]">
                    {o.display_name}
                    <span className="text-xs text-slate-500 ml-1">（{ROLE_LABEL[o.officer_role]}）</span>
                    {requiredIds.has(o.id) && <span className="text-xs text-blue-600 ml-1">★必要な承認者</span>}
                  </span>
                  {statusNode}
                  {stamp?.comment && <span className="text-xs text-slate-500 w-full pl-4">💬 {stamp.comment}</span>}
                </li>
              )
            })}
          </ul>
        </section>

        {canStamp && (
          <StampControls requestId={request.id} myIntent={myIntent} />
        )}
        {request.status === 'pending' && iAmExcluded && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            ⚖ あなたは本件の当事者のため、押印できません（決裁規程 第5条第3項）。
          </p>
        )}
        {request.status === 'pending' && me.officer_role === 'auditor' && (
          <p className="text-sm text-slate-500">
            👁 監査役として全件・全履歴を閲覧できます（押印はしません）。
          </p>
        )}

        {isRequester && request.status === 'pending' && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold">✏ 起案者メニュー</h2>
            <EditBodyForm requestId={request.id} initialBody={request.body} hasStamps={stamps.some((s) => s.action !== 'revoke')} />
            <WithdrawButton requestId={request.id} />
          </section>
        )}

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-1">📜 押印の履歴（すべての記録）</h2>
          <p className="text-xs text-slate-500 mb-3">
            電子印は追記のみで、あとから変更・削除できません。取消や本文修正の経緯もすべてここに残ります。
          </p>
          {stamps.length === 0 ? (
            <p className="text-sm text-slate-500">まだ押印はありません。</p>
          ) : (
            <ul className="space-y-2">
              {stamps.map((s) => {
                const o = officerById.get(s.member_id)
                const invalid = s.action !== 'revoke' && s.body_hash !== request.body_hash
                return (
                  <li key={s.id} className="text-sm flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 font-mono">{fmtDate(s.stamped_at)}</span>
                    <span className="font-medium">{o?.display_name ?? '（不明）'}</span>
                    <span className="text-xs text-slate-500">（{ROLE_LABEL[s.officer_role]}）</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ACTION_BADGE[s.action] ?? ''}`}>
                      {ACTION_LABEL[s.action]}
                    </span>
                    {invalid && <span className="text-[10px] text-amber-700 dark:text-amber-400">（本文変更により無効）</span>}
                    {s.comment && <span className="text-xs text-slate-500">💬 {s.comment}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
