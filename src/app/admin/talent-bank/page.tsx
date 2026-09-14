import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import ActionForm from '@/app/me/talent/_components/ActionForm'
import ProfileContent from '@/app/me/talent/_components/ProfileContent'
import { moderateAction } from './actions'
export default async function TalentBankAdminPage() {
  const db = await createTalentBankClient()
  const { data } = await db.auth.getUser()
  if (!data.user) redirect('/login')
  const admin = await db.rpc('is_admin')
  if (admin.error || !admin.data) redirect('/')
  const profiles = await db.from('talent_profiles').select('id,draft_version_id')
  const versions = await db.from('talent_profile_versions').select('*').eq('status', 'owner_reviewed').order('owner_approved_at')
  const tags = await db.from('talent_tags').select('*')
  if (profiles.error || versions.error || tags.error) throw new Error('Review queue unavailable')
  const currentDrafts = new Set(profiles.data?.map(p => p.draft_version_id))
  const cards = await Promise.all((versions.data ?? []).filter(v => currentDrafts.has(v.id)).map(async version => {
    const links = await db.from('talent_profile_version_tags').select('tag_id').eq('version_id', version.id)
    if (links.error) throw new Error('Review queue unavailable')
    return { version, tags: (tags.data ?? []).filter(t => links.data?.some(l => l.tag_id === t.id)) }
  }))
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
    <Link href="/admin" className="text-sm underline">← 管理画面</Link><h1 className="text-2xl font-semibold">人材バンク・公開承認</h1>
    {!cards.length && <p>承認待ちのプロフィールはありません。</p>}
    {cards.map(({ version, tags }) => <section key={version.id} className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">{version.fields_json.display_name?.value ?? '表示名未設定'} · 第{version.version}版</h2>
      <p>本人確認済み・運営確認待ち／公開範囲：{version.public_scope === 'public' ? '一般公開' : version.public_scope === 'registered_only' ? '会員のみ' : '非公開'}</p>
      <ProfileContent fields={version.fields_json} short={version.summary_short} long={version.summary_long} tags={tags} provenance />
      {!!version.suggested_tags.length && <p className="text-sm">未登録タグの提案（未採用）：{version.suggested_tags.join('、')}</p>}
      <p className="text-sm">本人の修正記録：{version.edited_by_owner_at ? 'あり（1回として記録）' : 'なし（0回）'}</p>
      <ActionForm action={moderateAction}><input type="hidden" name="versionId" value={version.id} />
        <label className="block">確認にかかった分数（必須）<input type="number" name="minutes" min={0} max={1440} step={1} required className="mt-2 block w-full rounded border bg-background p-3" /></label>
        <Button type="submit" name="intent" value="approve">承認して公開</Button>
      </ActionForm>
      <ActionForm action={moderateAction}><input type="hidden" name="versionId" value={version.id} />
        <label className="block">差し戻し理由（必須）<textarea name="reason" required maxLength={1000} rows={3} className="mt-2 w-full rounded border bg-background p-3" /></label>
        <Button type="submit" name="intent" value="reject" variant="outline">差し戻し</Button>
      </ActionForm>
    </section>)}
  </main>
}
