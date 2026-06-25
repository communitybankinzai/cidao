import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { createEvent } from '../actions'

export default async function NewEventPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/events/new')

  // 所属団体（officer 以上の team）
  const { data: orgs } = await supabase
    .from('memberships')
    .select('org_id, organizations(id, name)')
    .eq('member_id', user.id)
    .in('role', ['representative', 'officer'])
    .eq('status', 'confirmed')

  async function handleCreate(formData: FormData) {
    'use server'
    const organizer_type = String(formData.get('organizer_type') ?? 'member') as 'member' | 'org'
    await createEvent({
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
      category: String(formData.get('category') ?? 'other'),
      start_at: String(formData.get('start_at') ?? ''),
      end_at: String(formData.get('end_at') ?? ''),
      location: (formData.get('location') as string | null) || undefined,
      online_flag: formData.get('online_flag') === 'on',
      capacity: formData.get('capacity') ? Number(formData.get('capacity')) : undefined,
      fee: formData.get('fee') ? Number(formData.get('fee')) : undefined,
      organizer_type,
      organizer_org_id: organizer_type === 'org' ? String(formData.get('organizer_org_id') ?? '') : undefined,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleCreate} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/events" className="hover:underline">← イベント一覧</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しいイベント</h1>

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="タイトル" req>
            <input name="title" required maxLength={80} className={inp} />
          </L>
          <L label="説明" req>
            <textarea name="description" required rows={4} className={inp} />
          </L>
          <div className="grid md:grid-cols-2 gap-3">
            <L label="カテゴリ" req>
              <select name="category" required className={inp}>
                {PROPOSAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </L>
            <L label="主催">
              <select name="organizer_type" className={inp}>
                <option value="member">個人として</option>
                {orgs && orgs.length > 0 && <option value="org">所属団体として</option>}
              </select>
            </L>
          </div>
          {orgs && orgs.length > 0 && (
            <L label="主催団体（org 選択時）">
              <select name="organizer_org_id" className={inp}>
                {orgs.map((o) => {
                  const org = Array.isArray(o.organizations) ? o.organizations[0] : o.organizations
                  return <option key={o.org_id} value={o.org_id}>{org?.name ?? o.org_id}</option>
                })}
              </select>
            </L>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <L label="開始" req><input type="datetime-local" name="start_at" required className={inp} /></L>
            <L label="終了" req><input type="datetime-local" name="end_at" required className={inp} /></L>
          </div>
          <L label="場所"><input name="location" placeholder="例: 印西市役所 会議室" className={inp} /></L>
          <div className="grid md:grid-cols-3 gap-3">
            <L label="オンライン">
              <label className="flex gap-2 items-center text-sm"><input type="checkbox" name="online_flag" /> オンライン開催</label>
            </L>
            <L label="定員（任意）"><input type="number" name="capacity" min="1" className={inp} /></L>
            <L label="参加費（円、任意）"><input type="number" name="fee" min="0" className={inp} /></L>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Link href="/events"><Button variant="outline" type="button">キャンセル</Button></Link>
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
