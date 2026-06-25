import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { FREEFREE_CATEGORIES, FREEFREE_PERIODS } from '@/lib/freefree-categories'
import { createFreefreePost } from '../actions'

export default async function NewFreefreePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/freefree/new')

  async function handleCreate(formData: FormData) {
    'use server'
    await createFreefreePost({
      poster_type: String(formData.get('poster_type') ?? 'member') as 'member' | 'individual_business',
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      category: String(formData.get('category') ?? 'event'),
      location: (formData.get('location') as string | null) || undefined,
      period: String(formData.get('period') ?? 'p_1month') as 'p_1week' | 'p_1month' | 'p_3months',
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleCreate} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/freefree" className="hover:underline">← FreeFree</Link></nav>
        <h1 className="text-3xl font-serif font-bold">新しい掲載</h1>

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="掲載者">
            <select name="poster_type" className={inp}>
              <option value="member">個人として</option>
              <option value="individual_business">個人事業として</option>
            </select>
          </L>
          <L label="タイトル（40字）" req><input name="title" required maxLength={40} className={inp} /></L>
          <L label="本文（1000字、Markdown 可）" req>
            <textarea name="body" required maxLength={1000} rows={6} className={inp} />
          </L>
          <div className="grid md:grid-cols-2 gap-3">
            <L label="カテゴリ" req>
              <select name="category" required className={inp}>
                {FREEFREE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </L>
            <L label="掲載期間" req>
              <select name="period" required className={inp} defaultValue="p_1month">
                {FREEFREE_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </L>
          </div>
          <L label="場所"><input name="location" placeholder="例: 印西市草深" className={inp} /></L>
        </div>
        <div className="flex justify-end gap-2">
          <Link href="/freefree"><Button type="button" variant="outline">キャンセル</Button></Link>
          <Button type="submit">掲載する</Button>
        </div>
      </form>
    </div>
  )
}

const inp = "w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
function L({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-sm font-medium">{label}{req && <span className="text-red-500 ml-0.5">*</span>}</label>{children}</div>
}
