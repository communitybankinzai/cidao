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
const VIDEO_STATUS: Record<string, string> = { owner_review: '本人の確認待ち（運営は先に見られる）', owner_approved: '本人承認済み・掲載待ち', published: '掲載中', failed: '作成失敗', retired: '本人が作り直しを希望（この動画は取り下げ済み）' }
// 一覧の1行に出す短い言い方（長い説明は開いてから読む）
const INTRO_SHORT: Record<string, string> = { draft: '下書き', owner_review: '確認待ち', published: '掲載中', returned: '差し戻し' }
const VIDEO_SHORT: Record<string, string> = { owner_review: '本人確認待ち', owner_approved: '掲載待ち', published: '掲載中', failed: '失敗', retired: '本人から要望' }

// 人ごとの並び順。運営がすぐ手を動かせる人を上に置く
function rank(intro: { status: string } | null, videos: { status: string; owner_comment: string | null }[]) {
  if (videos.some(v => v.status === 'owner_approved')) return 0   // 掲載ボタンを押すだけ
  if (intro?.status === 'returned') return 1                      // 本人から直してほしい点が来ている
  if (videos.some(v => v.status === 'retired' && v.owner_comment)) return 1  // 動画にも本人からの要望が来ている
  if (!intro) return 2                                            // 他己紹介が未作成
  if (intro.status === 'draft') return 3                          // 下書きのまま止まっている
  if (videos.some(v => v.status === 'failed')) return 4
  return 5
}
const badge = (text: string, tone = '') => <span className={`rounded-full border px-2 py-0.5 text-xs font-normal ${tone}`}>{text}</span>

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

  // 他己紹介と紹介動画を人ごとに1行へまとめる。プロフィールを取り下げた人でも、動画が残っていれば行を出す
  const seen = new Set(intros.map(i => i.member.id))
  const rows = [
    ...intros.map(({ member, summary, intro }) => ({ id: member.id, name: member.display_name, summary, intro, videos: videos.filter(v => v.member_id === member.id) })),
    ...[...new Set(videos.map(v => v.member_id))].filter(id => !seen.has(id))
      .map(id => ({ id, name: names.get(id) ?? '（表示名なし）', summary: null, intro: null, videos: videos.filter(v => v.member_id === id) })),
  ].sort((a, b) => rank(a.intro, a.videos) - rank(b.intro, b.videos) || String(a.name).localeCompare(String(b.name), 'ja'))
  const todo = rows.filter(r => rank(r.intro, r.videos) <= 3).length

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

    <h2 className="text-xl font-semibold">メンバー（他己紹介と紹介動画）</h2>
    <p className="text-sm text-muted-foreground">
      1人1行です。名前を押すと、その人の他己紹介と紹介動画をまとめて扱えます。手を動かす番の人（掲載待ち・差し戻し・未作成）を上に並べています。
    </p>
    {!rows.length && <p>プロフィールを公開している人はまだいません。</p>}
    {!!rows.length && <p className="text-sm">{rows.length}人中、{todo ? `${todo}人が対応待ちです。` : '対応待ちはありません。'}</p>}

    <div className="divide-y rounded-xl border">
      {rows.map(({ id, name, summary, intro, videos: own }) => {
        const latest = own[0]  // adminVideoQueue は新しい順
        return <details key={id} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 hover:bg-muted/50">
            {latest?.storage_path
              ? <img src={`/api/talent-bank/video/${latest.id}?thumb=1`} alt="" className="h-14 w-9 shrink-0 rounded bg-black object-cover" />
              : <span className="flex h-14 w-9 shrink-0 items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground">動画<br />なし</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {badge(`紹介文 ${intro ? INTRO_SHORT[intro.status] ?? intro.status : '未作成'}`, intro?.status === 'published' ? 'text-green-700' : intro ? '' : 'text-amber-700')}
                {latest && badge(`動画 ${VIDEO_SHORT[latest.status] ?? latest.status}`, latest.status === 'published' ? 'text-green-700' : latest.status === 'failed' ? 'text-red-700' : '')}
                {own.some(v => v.status === 'retired' && v.owner_comment) && badge('本人からの要望あり', 'text-amber-700')}
                {own.length > 1 && badge(`動画 ほか${own.length - 1}本`)}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90">›</span>
          </summary>

          <div className="space-y-4 border-t p-4 text-sm">
            <section className="space-y-3">
              <h3 className="font-medium">他己紹介（CBI から見た{name}さん） {badge(intro ? INTRO_STATUS[intro.status] ?? intro.status : '未作成')}</h3>
              {summary && <p className="text-muted-foreground">紹介文：{summary}</p>}
              {intro?.status === 'returned' && intro.owner_comment && <p className="rounded border border-amber-500 p-2">本人から：{intro.owner_comment}</p>}
              <ActionForm action={introAdminAction} successText="AI が下書きを書きました。下の欄で直せます。"><input type="hidden" name="memberId" value={id} />
                <Button type="submit" name="intent" value="draft" variant="outline" size="sm">{intro ? 'AIで下書きを書き直す' : 'AIで下書き'}</Button>
              </ActionForm>
              <ActionForm key={`intro:${intro?.updated_at ?? 'none'}`} action={introAdminAction} successText="保存しました。"><input type="hidden" name="memberId" value={id} />
                <textarea name="body" maxLength={400} rows={6} defaultValue={intro?.body ?? ''} className="w-full rounded border bg-background p-3" placeholder="AI の下書きを読んで直す（400字以内）" />
                <label className="block">一読にかかった分数（必須）<input type="number" name="minutes" min={0} max={1440} step={1} required className="mt-2 block w-full rounded border bg-background p-3" /></label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="intent" value="save" variant="outline">下書きとして保存</Button>
                  <Button type="submit" name="intent" value="request">本人に確認を依頼</Button>
                </div>
              </ActionForm>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="font-medium">紹介動画</h3>
              {!own.length && <p className="text-muted-foreground">動画はまだありません。</p>}
              {own.map(v => <div key={v.id} className="space-y-3 rounded-lg border p-3">
                <p>{badge(VIDEO_STATUS[v.status] ?? v.status)}
                  <span className="text-muted-foreground">　{v.style}／{v.voice_name}／{v.bgm_credit}{v.duration_sec ? `／${Math.round(Number(v.duration_sec))}秒` : ''}</span></p>
                {v.status === 'failed' && <p className="text-red-700">失敗の理由：{v.error}</p>}
                {v.owner_comment && <p className="rounded border border-amber-500 p-2">本人から：{v.owner_comment}</p>}
                {v.storage_path && <video controls playsInline preload="none" poster={`/api/talent-bank/video/${v.id}?thumb=1`} src={`/api/talent-bank/video/${v.id}`} className="w-full max-w-xs rounded-lg bg-black" />}
                {v.status === 'owner_approved' && <ActionForm action={videoModerateAction}><input type="hidden" name="videoId" value={v.id} />
                  <label className="block">確認にかかった分数（必須）<input type="number" name="minutes" min={0} max={1440} step={1} required className="mt-2 block w-full rounded border bg-background p-3" /></label>
                  <Button type="submit" name="intent" value="publish">紹介ページに掲載する</Button>
                </ActionForm>}
                {(v.status === 'published' || v.status === 'owner_approved') && <ActionForm action={videoModerateAction}><input type="hidden" name="videoId" value={v.id} />
                  <Button type="submit" name="intent" value="retire" variant="outline" size="sm">掲載を下げる</Button>
                </ActionForm>}
              </div>)}
            </section>
          </div>
        </details>
      })}
    </div>
  </main>
}
