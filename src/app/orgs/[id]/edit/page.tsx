import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { canUserEditOrg } from '@/lib/org-permissions'
import { updateOrgInfo } from '../../actions'

// 団体情報の編集ページ。
// 編集権者：(a) representative_id 本人 / (b) memberships rep|officer + confirmed / (c) contact_email == JWT email
// 編集して保存すると info_verified=true がセットされる（=代表者が内容を承認した扱い）。

const SNS_FIELDS = [
  { key: 'x', label: 'X (Twitter)', placeholder: 'https://x.com/...' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://www.facebook.com/...' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://www.instagram.com/...' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://www.youtube.com/...' },
  { key: 'line', label: 'LINE', placeholder: 'https://line.me/...' },
  { key: 'note', label: 'note', placeholder: 'https://note.com/...' },
  { key: 'blog', label: 'ブログ', placeholder: 'https://...' },
]

export default async function EditOrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/orgs/${id}/edit`)

  const { data: org } = await supabase.from('organizations').select('*').eq('id', id).single()
  if (!org) notFound()

  const canEdit = await canUserEditOrg(supabase, org, user.id, user.email ?? null)
  if (!canEdit) redirect(`/orgs/${id}?error=forbidden`)

  const snsLinks: Record<string, string> = (org.sns_links && typeof org.sns_links === 'object')
    ? (org.sns_links as Record<string, string>)
    : {}

  const isUnverified = !!org.enriched_at && !org.info_verified

  async function save(formData: FormData) {
    'use server'
    const snsOut: Record<string, string> = {}
    for (const f of SNS_FIELDS) {
      const v = formData.get(`sns_${f.key}`)
      if (typeof v === 'string' && v.trim()) snsOut[f.key] = v.trim()
    }
    await updateOrgInfo(id, {
      description: formData.get('description') as string,
      activity_detail: formData.get('activity_detail') as string,
      activity_area: formData.get('activity_area') as string,
      website_url: formData.get('website_url') as string,
      contact_email: formData.get('contact_email') as string,
      contact_url: formData.get('contact_url') as string,
      sns_links: snsOut,
    })
    redirect(`/orgs/${id}?saved=1`)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href={`/orgs/${id}`} className="hover:underline">← {org.name} に戻る</Link>
        </nav>

        <header className="space-y-2">
          <h1 className="text-2xl font-serif font-bold">団体情報を編集</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{org.name}</p>
          {isUnverified && (
            <div className="text-xs px-3 py-2 bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 rounded">
              現在の内容は AI が Web から自動収集した暫定情報です。修正して保存すると「確認済み」になります。
            </div>
          )}
        </header>

        <form action={save} className="space-y-5 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="activity_detail">活動詳細</label>
            <textarea
              id="activity_detail"
              name="activity_detail"
              defaultValue={org.activity_detail ?? ''}
              rows={8}
              className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
              placeholder="団体の活動内容を詳しく記述してください（事業内容・主な活動・対象地域・実績・特徴など）"
            />
            <p className="text-xs text-slate-500 mt-1">200〜600文字程度を推奨。改行可。</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="description">短い説明（一覧表示用）</label>
            <textarea
              id="description"
              name="description"
              defaultValue={org.description ?? ''}
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
              placeholder="団体一覧などで表示される短い紹介文"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="activity_area">活動エリア</label>
              <input
                id="activity_area"
                name="activity_area"
                defaultValue={org.activity_area ?? ''}
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
                placeholder="例：印西市内全域、千葉県北総地域"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="website_url">公式サイト URL</label>
              <input
                id="website_url"
                name="website_url"
                type="url"
                defaultValue={org.website_url ?? ''}
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="contact_email">連絡先メール</label>
              <input
                id="contact_email"
                name="contact_email"
                type="email"
                defaultValue={org.contact_email ?? ''}
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
                placeholder="info@example.org"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="contact_url">問い合わせフォーム URL</label>
              <input
                id="contact_url"
                name="contact_url"
                type="url"
                defaultValue={org.contact_url ?? ''}
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
                placeholder="https://..."
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">SNS リンク</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              {SNS_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-500 mb-1" htmlFor={`sns_${f.key}`}>{f.label}</label>
                  <input
                    id={`sns_${f.key}`}
                    name={`sns_${f.key}`}
                    type="url"
                    defaultValue={snsLinks[f.key] ?? ''}
                    className="w-full border rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-800"
                    placeholder={f.placeholder}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="submit">保存して確認済みにする</Button>
            <Link href={`/orgs/${id}`}>
              <Button type="button" variant="ghost">キャンセル</Button>
            </Link>
          </div>
        </form>
      </article>
    </div>
  )
}
