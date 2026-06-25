import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'

const AVAILABLE_TIMES = ['平日昼', '平日夜', '土日昼', '土日夜', 'オンラインのみ']

export default async function MyPrPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/me/pr')

  const { data: pr } = await supabase
    .from('member_profiles_pr')
    .select('*')
    .eq('member_id', user.id)
    .maybeSingle()

  async function handleSave(formData: FormData) {
    'use server'
    const sb = await createClient()
    const { data: { user: u } } = await sb.auth.getUser()
    if (!u) throw new Error('未ログイン')

    const times = formData.getAll('available_times').map(String)
    const payload = {
      member_id: u.id,
      qualifications: (formData.get('qualifications') as string | null) || null,
      interests_free_text: (formData.get('interests_free_text') as string | null) || null,
      contributions: (formData.get('contributions') as string | null) || null,
      available_times: times,
      message_acceptance: String(formData.get('message_acceptance') ?? 'recommended_only') as 'open' | 'recommended_only' | 'closed',
      public_scope: String(formData.get('public_scope') ?? 'registered_only') as 'public' | 'registered_only' | 'consent_only',
    }
    await sb.from('member_profiles_pr').upsert(payload, { onConflict: 'member_id' })
    redirect('/me')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleSave} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href="/me" className="hover:underline">← マイページ</Link></nav>
        <h1 className="text-3xl font-serif font-bold">人材バンクPR編集</h1>

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="資格・経歴">
            <textarea name="qualifications" rows={3} defaultValue={pr?.qualifications ?? ''} className={inp} />
          </L>
          <L label="好きなこと・興味（自由記述）">
            <textarea name="interests_free_text" rows={2} defaultValue={pr?.interests_free_text ?? ''} className={inp} />
          </L>
          <L label="できそうな貢献（600字以内）">
            <textarea name="contributions" rows={4} maxLength={600} defaultValue={pr?.contributions ?? ''} className={inp} />
          </L>
          <L label="対応可能時間">
            <div className="flex gap-3 flex-wrap text-sm">
              {AVAILABLE_TIMES.map((t) => (
                <label key={t} className="flex gap-1 items-center">
                  <input type="checkbox" name="available_times" value={t} defaultChecked={(pr?.available_times ?? []).includes(t)} />
                  {t}
                </label>
              ))}
            </div>
          </L>
          <L label="声掛け受付">
            <select name="message_acceptance" defaultValue={pr?.message_acceptance ?? 'recommended_only'} className={inp}>
              <option value="open">誰からでも</option>
              <option value="recommended_only">AI推薦経由のみ（推奨）</option>
              <option value="closed">受け付けない</option>
            </select>
          </L>
          <L label="公開範囲">
            <select name="public_scope" defaultValue={pr?.public_scope ?? 'registered_only'} className={inp}>
              <option value="public">完全公開</option>
              <option value="registered_only">登録ユーザーのみ</option>
              <option value="consent_only">連携同意者のみ</option>
            </select>
          </L>
        </div>
        <div className="flex justify-end gap-2">
          <Link href="/me"><Button type="button" variant="outline">キャンセル</Button></Link>
          <Button type="submit">保存</Button>
        </div>
      </form>
    </div>
  )
}

const inp = "w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-sm font-medium">{label}</label>{children}</div>
}
