import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createProposal } from '../actions'
import { PROPOSAL_CATEGORIES, BUDGET_SIZES, BINDING_TYPES } from '@/lib/categories'
import { Button } from '@/components/ui/button'

export default async function NewProposalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/proposals/new')

  const { data: member } = await supabase
    .from('members')
    .select('tier, display_name')
    .eq('id', user.id)
    .single()

  if (!member || member.tier === 'light') {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold">本登録が必要です</h1>
          <p className="text-slate-600">
            提案投稿には本登録（メール認証以上）が必要です。マイページからプロフィールを完成させてください。
          </p>
          <Button asChild>
            <a href="/">ホームへ戻る</a>
          </Button>
        </div>
      </div>
    )
  }

  async function handleCreate(formData: FormData) {
    'use server'
    const related = [
      formData.get('related_1'),
      formData.get('related_2'),
      formData.get('related_3'),
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

    await createProposal({
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      category: String(formData.get('category') ?? 'other'),
      binding_type: String(formData.get('binding_type') ?? 'external') as 'internal' | 'hosted' | 'external',
      budget_size: String(formData.get('budget_size') ?? 'small') as 'small' | 'medium' | 'large',
      implementation_date: String(formData.get('implementation_date') ?? ''),
      related_links: related,
      start_immediately: false,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleCreate} className="max-w-3xl mx-auto space-y-6">
        <header>
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Citizen DAO</p>
          <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">新しい提案</h1>
          <p className="text-sm text-slate-500 mt-2">
            投稿後 48 時間の議論期間を経て、自動的に投票期間（小:3日 / 中:7日 / 大:14日）に移行します
          </p>
        </header>

        <div className="space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <Field label="タイトル（60字以内）" required>
            <input
              name="title"
              required
              maxLength={60}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100"
              placeholder="例: 印西駅前マルシェの月次開催"
            />
          </Field>

          <Field label="本文（2000字以内、Markdown 可）" required>
            <textarea
              name="body"
              required
              maxLength={2000}
              rows={10}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100"
              placeholder="背景・目的・実施内容・期待効果など"
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="カテゴリ" required>
              <select
                name="category"
                required
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {PROPOSAL_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </Field>

            <Field label="予算規模" required>
              <select
                name="budget_size"
                required
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {BUDGET_SIZES.map((b) => (
                  <option key={b.key} value={b.key}>{b.label}（投票{b.votingDays}日）</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="拘束力種別" required>
            <div className="space-y-2">
              {BINDING_TYPES.map((b) => (
                <label key={b.key} className="flex items-start gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="radio"
                    name="binding_type"
                    value={b.key}
                    required
                    defaultChecked={b.key === 'external'}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{b.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </Field>

          <Field label="実施予定日" required>
            <input
              name="implementation_date"
              type="date"
              required
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="関連リンク（最大3）">
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <input
                  key={i}
                  name={`related_${i}`}
                  type="url"
                  placeholder="https://..."
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                />
              ))}
            </div>
          </Field>
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <a href="/proposals">キャンセル</a>
          </Button>
          <Button type="submit">投稿する</Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
