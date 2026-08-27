import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { pickRule, ROLE_LABEL, type ApprovalRule, type Officer, type OfficerRole } from '@/lib/approval'
import { RequestForm } from '../_components/RequestForm'

// 起案フォーム。役員がブラウザだけで完結できるようにする
// （md や Git は使わない。本文欄に直接書けば添付は不要）。

export const dynamic = 'force-dynamic'

export default async function NewApprovalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/approvals/new')

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
  if (meRow.officer_role === 'auditor') redirect('/admin/approvals') // 監査役は閲覧のみ

  const [{ data: ruleRows }, { data: officerRows }] = await Promise.all([
    service.from('approval_rules').select('*'),
    service.from('members').select('id, display_name, officer_role').not('officer_role', 'is', null).is('deleted_at', null),
  ])
  const allRules = (ruleRows ?? []) as ApprovalRule[]
  const officers = (officerRows ?? []) as Officer[]
  const nowIso = new Date().toISOString()

  // 現在有効な版の基準を区分ごとに1つ選び、画面表示用に整形する
  const categories = (['project', 'expense', 'document', 'conflict_of_interest'] as const)
    .map((cat) => {
      const rule = pickRule(allRules, cat, nowIso)
      if (!rule) return null
      const approverNames = rule.required_roles
        .map((role) => {
          const holder = officers.find((o) => o.officer_role === role)
          const roleLabel = ROLE_LABEL[role as OfficerRole] ?? role
          return holder ? `${roleLabel}（${holder.display_name}）` : `${roleLabel}（担当者未設定）`
        })
        .join(' と ')
      return {
        category: rule.category,
        label: rule.label,
        description: rule.description ?? '',
        approverNames,
        thresholdAmount: rule.threshold_amount,
        deadlineDays: rule.deadline_days,
        excludeInvolved: rule.exclude_involved,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const officerOptions = officers
    .filter((o) => o.id !== meRow.id)
    .map((o) => ({
      id: o.id,
      label: `${o.display_name}（${ROLE_LABEL[o.officer_role]}）`,
    }))

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/admin/approvals" className="hover:underline">← 電子決裁の一覧へ</Link>
        </nav>
        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">CBI 役員</p>
          <h1 className="text-3xl font-serif font-bold">📝 決裁の起案</h1>
          <p className="text-sm text-slate-500">
            件名・区分・内容を入力してください。<b>本文欄に直接書けば、ファイルを作って添付する必要はありません。</b>
            見積書や領収書など、すでに資料がある場合だけ添付してください（スマホで撮った写真でも構いません）。
          </p>
        </header>
        {categories.length === 0 ? (
          <p className="text-sm text-red-600">
            決裁基準（approval_rules）が未登録です。マイグレーションの適用を確認してください。
          </p>
        ) : (
          <RequestForm categories={categories} officerOptions={officerOptions} />
        )}
      </div>
    </div>
  )
}
