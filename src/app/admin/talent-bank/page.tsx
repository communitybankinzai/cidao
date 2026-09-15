import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import ActionForm from '@/app/me/talent/_components/ActionForm'
import ProfileContent from '@/app/me/talent/_components/ProfileContent'
import { moderateAction } from './actions'
import { videoModerateAction } from './video-actions'
import { adminVideoQueue } from '@/lib/talent-bank/video/jobs'
import { introAdminAction } from './intro-actions'
import { adminIntroQueue } from '@/lib/talent-bank/cbi-intro'
const INTRO_STATUS: Record<string, string> = { draft: '下書き（本人には見えない）', owner_review: '本人の確認待ち', published: '掲載中', returned: '本人から差し戻し' }
const VIDEO_STATUS: Record<string, string> = { owner_approved: '本人承認済み・掲載待ち', published: '掲載中', failed: '作成失敗' }
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
  const [videos, intros] = await Promise.all([adminVideoQueue(data.user.id), adminIntroQueue(data.user.id)])
  const memberRows = videos.length ? await db.from('members').select('id, display_name').in('id', [...new Set(videos.map(v => v.member_id))]) : { data: [] }
  const names = new Map((memberRows.data ?? []).map(m => [m.id, m.display_name]))
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

    <h2 className="text-xl font-semibold">他己紹介（CBI から見た○○さん）</h2>
    <p className="text-sm text-muted-foreground">プロフィールを公開している人が並びます。「AIで下書き」→読んで直す→「本人に確認を依頼」。本人が承認すると紹介ページ（会員のみ）に載ります。</p>
    {!intros.length && <p>プロフィールを公開している人はまだいません。</p>}
    {intros.map(({ member, summary, intro }) => <section key={member.id} className="space-y-3 rounded-xl border p-4 text-sm">
      <p className="font-medium">{member.display_name} <span className="rounded-full border px-2 py-0.5 text-xs font-normal">{intro ? INTRO_STATUS[intro.status] : '未作成'}</span></p>
      {summary && <p className="text-muted-foreground">紹介文：{summary}</p>}
      {intro?.status === 'returned' && intro.owner_comment && <p className="rounded border border-amber-500 p-2">本人から：{intro.owner_comment}</p>}
      <ActionForm action={introAdminAction} successText="AI が下書きを書きました。下の欄で直せます。"><input type="hidden" name="memberId" value={member.id} />
        <Button type="submit" name="intent" value="draft" variant="outline" size="sm">{intro ? 'AIで下書きを書き直す' : 'AIで下書き'}</Button>
      </ActionForm>
      <ActionForm key={`intro:${intro?.updated_at ?? 'none'}`} action={introAdminAction} successText="保存しました。"><input type="hidden" name="memberId" value={member.id} />
        <textarea name="body" maxLength={400} rows={6} defaultValue={intro?.body ?? ''} className="w-full rounded border bg-background p-3" placeholder="AI の下書きを読んで直す（400字以内）" />
        <label className="block">一読にかかった分数（必須）<input type="number" name="minutes" min={0} max={1440} step={1} required className="mt-2 block w-full rounded border bg-background p-3" /></label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="save" variant="outline">下書きとして保存</Button>
          <Button type="submit" name="intent" value="request">本人に確認を依頼</Button>
        </div>
      </ActionForm>
    </section>)}

    <h2 className="text-xl font-semibold">紹介動画</h2>
    {!videos.length && <p>本人が承認した動画・掲載中の動画はありません。</p>}
    {videos.map(v => <section key={v.id} className="space-y-3 rounded-xl border p-4 text-sm">
      <p><span className="rounded-full border px-2 py-0.5 text-xs">{VIDEO_STATUS[v.status] ?? v.status}</span> {names.get(v.member_id) ?? '（表示名なし）'}
        <span className="text-muted-foreground">　{v.style}／{v.voice_name}／{v.bgm_credit}{v.duration_sec ? `／${Math.round(Number(v.duration_sec))}秒` : ''}</span></p>
      {v.status === 'failed' && <p className="text-red-700">失敗の理由：{v.error}</p>}
      {v.storage_path && <video controls playsInline preload="metadata" poster={`/api/talent-bank/video/${v.id}?thumb=1`} src={`/api/talent-bank/video/${v.id}`} className="w-full max-w-xs rounded-lg bg-black" />}
      {v.status === 'owner_approved' && <ActionForm action={videoModerateAction}><input type="hidden" name="videoId" value={v.id} />
        <label className="block">確認にかかった分数（必須）<input type="number" name="minutes" min={0} max={1440} step={1} required className="mt-2 block w-full rounded border bg-background p-3" /></label>
        <Button type="submit" name="intent" value="publish">紹介ページに掲載する</Button>
      </ActionForm>}
      {(v.status === 'published' || v.status === 'owner_approved') && <ActionForm action={videoModerateAction}><input type="hidden" name="videoId" value={v.id} />
        <Button type="submit" name="intent" value="retire" variant="outline" size="sm">掲載を下げる</Button>
      </ActionForm>}
    </section>)}
  </main>
}
