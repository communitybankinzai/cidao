import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { createEvent } from '../actions'
import { ImageScanField } from './_components/ImageScanField'
import { OrganizerPicker } from './_components/OrganizerPicker'

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/events/new')

  // ?date=YYYY-MM-DD が来ていればその日 10:00〜11:00（JST）を初期値にする
  const initialStart = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? `${sp.date}T10:00` : ''
  const initialEnd = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? `${sp.date}T11:00` : ''

  // 所属団体（officer 以上の team）
  const { data: memberRows } = await supabase
    .from('memberships')
    .select('org_id, organizations(id, name)')
    .eq('member_id', user.id)
    .in('role', ['representative', 'officer'])
    .eq('status', 'confirmed')

  const memberOrgs = (memberRows ?? [])
    .map((r) => {
      const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
      return o ? { id: o.id, name: o.name } : null
    })
    .filter((x): x is { id: string; name: string } => x !== null)

  // 全登録団体（最大500、名前順）。代理登録で「ある団体のイベント」として記録できるよう一覧化。
  const { data: allOrgRows } = await supabase
    .from('organizations')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(500)
  const allOrgs = (allOrgRows ?? []) as { id: string; name: string }[]

  async function handleCreate(formData: FormData) {
    'use server'
    const organizer_choice = String(formData.get('organizer_choice') ?? '__member__')
    const organizer_name_text = organizer_choice === '__external__'
      ? String(formData.get('organizer_name_text') ?? '').trim() || undefined
      : undefined
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
      organizer_choice,
      organizer_name_text,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleCreate} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/events" className="hover:underline">← イベント一覧</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しいイベント</h1>

        <ImageScanField />

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="タイトル" req>
            <input name="title" required maxLength={80} className={inp} />
          </L>
          <L label="説明" req>
            <textarea name="description" required rows={4} className={inp} />
          </L>
          <L label="カテゴリ" req>
            <select name="category" required className={inp}>
              {PROPOSAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </L>
          <OrganizerPicker memberOrgs={memberOrgs} allOrgs={allOrgs} />
          <div className="grid md:grid-cols-2 gap-3">
            <L label="開始" req><input type="datetime-local" name="start_at" required className={inp} defaultValue={initialStart} /></L>
            <L label="終了" req><input type="datetime-local" name="end_at" required className={inp} defaultValue={initialEnd} /></L>
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
