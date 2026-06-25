import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { createOrganization } from '../actions'

export default async function NewOrgPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/orgs/new')

  const { data: member } = await supabase.from('members').select('tier').eq('id', user.id).single()
  if (!member || member.tier !== 'verified') {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-md">
          <h1 className="text-2xl font-bold">住所確認が必要です</h1>
          <p className="text-slate-600">団体登録には住所確認済 tier が必要です（仕様§3.7.1）</p>
          <Link href="/me"><Button>マイページへ</Button></Link>
        </div>
      </div>
    )
  }

  async function handleCreate(formData: FormData) {
    'use server'
    const categories = formData.getAll('categories').map(String)
    await createOrganization({
      name: String(formData.get('name') ?? ''),
      type: String(formData.get('type') ?? 'voluntary') as 'voluntary' | 'civic' | 'company' | 'government',
      description: (formData.get('description') as string | null) ?? undefined,
      inzai_registration_number: (formData.get('inzai_registration_number') as string | null) ?? undefined,
      contact_email: (formData.get('contact_email') as string | null) ?? undefined,
      contact_url: (formData.get('contact_url') as string | null) ?? undefined,
      categories,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleCreate} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/orgs" className="hover:underline">← 団体一覧</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しい団体</h1>

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="団体名" req><input name="name" required maxLength={100} className={inp} /></L>
          <L label="種別" req>
            <select name="type" required className={inp}>
              <option value="voluntary">任意団体</option>
              <option value="civic">市民活動団体</option>
              <option value="company">企業</option>
              <option value="government">行政</option>
            </select>
          </L>
          <L label="印西市民活動団体登録番号（市民活動団体のみ）">
            <input name="inzai_registration_number" placeholder="例: 08-001" className={inp} />
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
