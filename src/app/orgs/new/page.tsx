import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { LEGAL_FORM_LABEL, LEGAL_FORM_ORDER, TYPE_LABEL, TYPE_ORDER } from '@/lib/org-labels'
import { createOrganization } from '../actions'

export default async function NewOrgPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/orgs/new')

  const { data: member } = await supabase.from('members').select('tier').eq('id', user.id).single()
  if (!member || member.tier === 'light') {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-md">
          <h1 className="text-2xl font-bold">本登録が必要です</h1>
          <p className="text-slate-600">団体登録にはマイページからの本登録（プロフィール完成）が必要です</p>
          <Link href="/me/edit"><Button>本登録フォームへ</Button></Link>
        </div>
      </div>
    )
  }

  async function handleCreate(formData: FormData) {
    'use server'
    const categories = formData.getAll('categories').map(String)
    const asRep = formData.get('as_representative') === 'yes'
    await createOrganization({
      name: String(formData.get('name') ?? ''),
      type: String(formData.get('type') ?? 'civic_group') as 'civic_group' | 'business' | 'government',
      legal_form: (formData.get('legal_form') as string | null) || undefined,
      description: (formData.get('description') as string | null) ?? undefined,
      inzai_registration_number: (formData.get('inzai_registration_number') as string | null) ?? undefined,
      contact_email: (formData.get('contact_email') as string | null) ?? undefined,
      contact_url: (formData.get('contact_url') as string | null) ?? undefined,
      categories,
      as_representative: asRep,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleCreate} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/orgs" className="hover:underline">← 団体一覧</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しい団体</h1>

        <div className="bg-sky-50 dark:bg-sky-950 border-l-4 border-sky-500 p-3 rounded text-sm">
          登録後、管理者の承認を経て一般公開されます。印西市市民活動推進条例 第10条で市に登録した団体は「印西市民活動団体登録番号」（例: 08-001）を入力できます（任意）。
        </div>

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="団体名" req><input name="name" required maxLength={100} className={inp} /></L>
          <L label="種別（条例第2条）" req>
            <select name="type" required defaultValue="civic_group" className={inp}>
              {TYPE_ORDER.map((k) => (
                <option key={k} value={k}>{TYPE_LABEL[k]}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              市民活動団体: 営利目的でない市民活動を主目的とする団体（NPO法人/任意団体/町内会等の法人格は問わない）。
              事業者: 営利事業を行うが市民活動も行うもの。
            </p>
          </L>
          <L label="法人格">
            <select name="legal_form" defaultValue="" className={inp}>
              <option value="">（選択しない）</option>
              {LEGAL_FORM_ORDER.map((k) => (
                <option key={k} value={k}>{LEGAL_FORM_LABEL[k]}</option>
              ))}
            </select>
          </L>
          <L label="印西市市民活動推進条例 第10条登録番号（登録済みの場合のみ）">
            <input name="inzai_registration_number" placeholder="例: 08-001" className={inp} />
            <p className="text-xs text-slate-500 mt-1">
              この登録は「協働の機会への参加・提案権」を得るためのもの。登録は任意で、市民活動団体でなくても登録可能。
            </p>
          </L>
          <L label="説明"><textarea name="description" rows={4} className={inp} /></L>
          <L label="活動分野（複数）" req>
            <div className="grid grid-cols-2 gap-1">
              {PROPOSAL_CATEGORIES.map((c) => (
                <label key={c.key} className="flex gap-2 items-center text-sm">
                  <input type="checkbox" name="categories" value={c.key} /> {c.label}
                </label>
              ))}
            </div>
          </L>
          <L label="連絡メール"><input type="email" name="contact_email" className={inp} /></L>
          <L label="ウェブサイト URL"><input type="url" name="contact_url" placeholder="https://..." className={inp} /></L>

          <L label="あなたとこの団体の関係" req>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" name="as_representative" value="no" defaultChecked className="mt-1" />
                <span>
                  <strong>代表者ではない</strong>（情報を入れただけ／会員として参加など）
                  <span className="block text-xs text-slate-500">
                    representative_id は空のまま作成。後で本人が「私が代表者」と申告するか、管理者が手動で代表者を設定する。
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="as_representative" value="yes" className="mt-1" />
                <span>
                  <strong>私がこの団体の代表者です</strong>
                  <span className="block text-xs text-slate-500">
                    あなたを representative_id として登録。一般ユーザーの場合は管理者承認後に確定。
                  </span>
                </span>
              </label>
            </div>
          </L>
        </div>
        <div className="flex justify-end gap-2">
          <Link href="/orgs"><Button variant="outline" type="button">キャンセル</Button></Link>
          <Button type="submit">登録</Button>
        </div>
      </form>
    </div>
  )
}

const inp = "w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
function L({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-sm font-medium">{label}{req && <span className="text-red-500 ml-0.5">*</span>}</label>{children}</div>
}
