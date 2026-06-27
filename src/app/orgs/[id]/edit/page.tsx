import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { OrgLogo } from '@/components/ui/org-logo'
import { canUserEditOrg } from '@/lib/org-permissions'
import { LEGAL_FORM_LABEL, LEGAL_FORM_ORDER } from '@/lib/org-labels'
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

    // ロゴアップロード（あれば）
    let newLogoUrl: string | undefined
    const logoFile = formData.get('logo') as File | null
    const removeLogo = formData.get('remove_logo') === '1'
    if (removeLogo) {
      newLogoUrl = ''  // 空文字で送って clean() が NULL に変換
    } else if (logoFile && logoFile.size > 0) {
      const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      if (supaUrl && serviceKey) {
        const admin = createSupabaseClient(supaUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const ext = (logoFile.name.split('.').pop() ?? 'png').toLowerCase().slice(0, 4)
        const path = `org-${id}-${Date.now()}.${ext}`
        const buf = Buffer.from(await logoFile.arrayBuffer())
        const { error: upErr } = await admin.storage
          .from('org-logos')
          .upload(path, buf, { contentType: logoFile.type || 'image/png', upsert: true })
        if (!upErr) {
          const { data: pub } = admin.storage.from('org-logos').getPublicUrl(path)
          newLogoUrl = pub.publicUrl
        }
      }
    }

    await updateOrgInfo(id, {
      description: formData.get('description') as string,
      activity_detail: formData.get('activity_detail') as string,
      activity_area: formData.get('activity_area') as string,
      website_url: formData.get('website_url') as string,
      contact_email: formData.get('contact_email') as string,
      contact_url: formData.get('contact_url') as string,
      legal_form: formData.get('legal_form') as string,
      inzai_registration_number: formData.get('inzai_registration_number') as string,
      sns_links: snsOut,
      ...(newLogoUrl !== undefined && { logo_url: newLogoUrl }),
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
          <div className="flex items-center gap-4">
            <OrgLogo src={org.logo_url} name={org.name} size="xl" />
            <div className="flex-1 space-y-2">
              <label className="block text-sm font-medium" htmlFor="logo">団体ロゴ（5MB以下、png/jpg/webp/gif/svg）</label>
              <input
                id="logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-slate-100 dark:file:bg-slate-700 file:text-sm hover:file:bg-slate-200 dark:hover:file:bg-slate-600"
              />
              {org.logo_url && (
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input type="checkbox" name="remove_logo" value="1" /> 既存ロゴを削除する
                </label>
              )}
              <p className="text-xs text-slate-500">未選択なら既存ロゴをそのまま維持</p>
            </div>
          </div>

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
              <label className="block text-sm font-medium mb-1" htmlFor="legal_form">法人格</label>
              <select
                id="legal_form"
                name="legal_form"
                defaultValue={org.legal_form ?? ''}
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
              >
                <option value="">（選択しない）</option>
                {LEGAL_FORM_ORDER.map((k) => (
                  <option key={k} value={k}>{LEGAL_FORM_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="inzai_registration_number">
                印西市市民活動推進条例 第10条登録番号
              </label>
              <input
                id="inzai_registration_number"
                name="inzai_registration_number"
                defaultValue={org.inzai_registration_number ?? ''}
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
                placeholder="例：08-001（未登録なら空欄）"
              />
            </div>
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
