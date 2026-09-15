import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CONSENT_TEXTS, hasConsent } from '@/lib/consents'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { currentInterview } from '@/lib/talent-bank/interview/access'
import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import { reviewAction } from './actions'
import ActionForm from './_components/ActionForm'
import EditChat from './_components/EditChat'
import GenerateForm from './_components/GenerateForm'
import ProfileContent from './_components/ProfileContent'

const SCOPE_LABEL = {
  registered_only: 'CiDAOにログインした会員だけ',
  public: '一般公開（だれでも見られる）',
  private: '非公開（自分と運営だけ）',
} as const
const STATUS_LABEL = { draft: '確認中', owner_reviewed: '公開申請中（運営の確認待ち）', approved: '運営承認済み', published: '公開中', retired: '公開停止・旧版' } as const

export const maxDuration = 60
// 2026-09-15 作り替え：20項目のフォームをやめ、「完成カードを見る → 話しかけて直す → 申請」の流れにした。
// 項目ごとの入力欄は「細かく直す」に畳んで残す。
export default async function MyTalentPage() {
  const db = await createTalentBankClient()
  const { data } = await db.auth.getUser()
  if (!data.user) redirect('/login?next=/me/talent')
  const memberId = data.user.id
  const [profiles, tags, interview] = await Promise.all([
    db.from('talent_profiles').select('*').eq('member_id', memberId).order('updated_at', { ascending: false }),
    db.from('talent_tags').select('*').order('label'), currentInterview(memberId),
  ])
  if (profiles.error || tags.error) throw new Error('Profile unavailable')
  const cards = await Promise.all((profiles.data ?? []).map(async profile => {
    const versions = await db.from('talent_profile_versions').select('*').eq('profile_id', profile.id).order('version', { ascending: false })
    if (versions.error) throw new Error('Profile unavailable')
    const version = versions.data?.find(v => v.id === profile.draft_version_id) ?? versions.data?.find(v => v.id === profile.current_version_id) ?? versions.data?.[0]
    const links = version ? await db.from('talent_profile_version_tags').select('tag_id').eq('version_id', version.id) : { data: [], error: null }
    if (links.error) throw new Error('Profile unavailable')
    return { profile, version, selected: new Set((links.data ?? []).map(t => t.tag_id)), versions: versions.data ?? [] }
  }))
  const consented = interview ? await hasConsent({ memberId, subjectId: interview.subject_id, kind: 'profile', version: CONSENT_TEXTS.profile.version }) : false
  const first = cards[0]?.version
  const step = !first ? 0 : first.status === 'published' ? 4 : first.status === 'owner_reviewed' ? 3 : 2
  const steps = ['インタビュー', 'プロフィール案の作成', '確認して「公開を申請」', '運営（CBI）の確認', '公開']
  const guide = step === 2 ? '下のカードが、他の人から見える姿です。直したいところがあれば、その下の欄に話しかけてください。よければ公開範囲を選んで「この内容で公開を申請」を押します。'
    : step === 3 ? '申請を受け付けました。運営が確認して公開します。結果はベル通知でお知らせします。申請中でも、話しかけて直せます（直すと申請し直しになります）。'
    : step === 4 ? '公開中です。直したいときは「新しい版を作って直す」から。' : ''

  return <main className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6">
    <nav><Link href="/talent" className="text-sm underline">← 人材バンク</Link></nav>
    <h1 className="text-2xl font-semibold">あなたのプロフィール</h1>
    {!cards.length && <p>インタビューが終わると、ここにプロフィール案ができます。<Link href="/talent/interview" className="underline">インタビューへ</Link></p>}
    {cards.length > 0 && <section aria-label="進み具合" className="space-y-2 rounded-xl border border-sky-600 bg-sky-50 p-4 text-sm dark:bg-sky-950">
      <ol className="space-y-1">{steps.map((label, i) => <li key={label} className={i === step ? 'font-semibold' : i < step ? 'text-muted-foreground line-through' : 'text-muted-foreground'}>
        {i < step ? '✓' : i === step ? '▶' : '・'} {label}</li>)}</ol>
      <p>{guide}</p>
    </section>}

    {cards.map(({ profile, version, selected, versions }) => {
      if (!version) return null
      const editable = version.status === 'draft' || version.status === 'owner_reviewed'
      const chosenTags = (tags.data ?? []).filter(t => selected.has(t.id))
      const missing = INTERVIEW_FIELDS.filter(f => !f.required && (version.fields_json[f.field_key]?.state ?? 'unknown') === 'unknown').map(f => f.label)
      const name = version.fields_json.display_name?.value ?? 'プロフィール'
      return <section key={profile.id} className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-medium">{name}<span className="ml-2 text-sm text-muted-foreground">第{version.version}版</span></h2>
          <span role="status" className="rounded-full border px-3 py-1 text-xs">{STATUS_LABEL[version.status]}</span>
        </div>
        {version.rejected_reason && <p className="rounded border border-amber-500 p-3 text-sm">運営からの修正のお願い：{version.rejected_reason}</p>}
        {profile.current_version_id && <div className="space-y-3 rounded-xl border p-4 text-sm">
          <p>公開中：第{versions.find(v => v.id === profile.current_version_id)?.version}版（{SCOPE_LABEL[profile.public_scope]}）</p>
          <Link href={`/talent/${profile.member_id}?subject=${profile.subject_id}`} className="underline">他の人から見た表示を開く</Link>
          <ActionForm key={`unpublish:${profile.updated_at}`} action={reviewAction} successText="公開を停止しました。">
            <input type="hidden" name="profileId" value={profile.id} />
            <Button type="submit" name="intent" value="unpublish" variant="outline">公開を停止</Button>
          </ActionForm>
        </div>}

        {editable ? <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">他の人からはこう見えます</h3>
            <ProfileContent key={version.updated_at} fields={version.fields_json} short={version.summary_short} long={version.summary_long} tags={chosenTags} />
          </div>

          <EditChat key={version.id} versionId={version.id} missing={missing} />

          <ActionForm key={`apply:${version.updated_at}`} action={reviewAction} successText="申請しました。">
            <input type="hidden" name="versionId" value={version.id} />
            <label className="block font-medium">公開する範囲
              <select name="public_scope" defaultValue={version.public_scope === 'private' ? 'registered_only' : version.public_scope} className="mt-2 block w-full rounded border bg-background p-3 font-normal">
                {/* 原則公開（2026-09-15 中司さん決定）：非公開は選べない。公開停止は別のボタンで行う */}
                {(['registered_only', 'public'] as const).map(value => <option key={value} value={value}>{SCOPE_LABEL[value]}</option>)}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">申請すると、運営（CBI）が内容を確認してから公開します。結果はベル通知でお知らせします。</p>
            <Button type="submit" name="intent" value="approve" className="w-full">{version.status === 'owner_reviewed' ? 'この内容で申請し直す' : 'この内容で公開を申請'}</Button>
          </ActionForm>

          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">項目ごとに細かく直す（入力欄を開く）</summary>
            <div className="mt-4">
              <ActionForm key={`detail:${version.updated_at}`} action={reviewAction}>
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="tags_present" value="1" />
                <p className="text-sm text-muted-foreground">文章を書いた項目は「回答あり」として保存します。空にした項目は「未回答」になり、公開されません。</p>
                <label className="block space-y-2"><span>短い紹介（80字以内）</span><textarea name="summary_short" maxLength={80} defaultValue={version.summary_short ?? ''} rows={2} className="w-full rounded border bg-background p-3" /></label>
                <label className="block space-y-2"><span>詳しい紹介（400字以内）</span><textarea name="summary_long" maxLength={400} defaultValue={version.summary_long ?? ''} rows={6} className="w-full rounded border bg-background p-3" /></label>
                {INTERVIEW_FIELDS.map(f => {
                  const item = version.fields_json[f.field_key]
                  return <fieldset key={f.field_key} className="space-y-2 rounded border p-3">
                    <legend className="px-1 text-sm font-medium">{f.label}{f.required && '（必須）'}</legend>
                    <textarea name={`${f.field_key}:value`} maxLength={2000} defaultValue={item?.value ?? ''} rows={2} className="w-full rounded border bg-background p-2" />
                    <label className="block text-xs text-muted-foreground">空欄のときの扱い
                      <select name={`${f.field_key}:state`} defaultValue={item?.state === 'none' || item?.state === 'declined' ? item.state : 'unknown'} className="ml-2 rounded border bg-background p-1">
                        <option value="unknown">未回答</option><option value="none">該当なし</option><option value="declined">載せない</option>
                      </select>
                    </label>
                  </fieldset>
                })}
                <fieldset className="rounded border p-3"><legend className="px-1 text-sm font-medium">タグ</legend>
                  <div className="flex flex-wrap gap-3">{tags.data?.map(tag => <label key={tag.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="tag" value={tag.id} defaultChecked={selected.has(tag.id)} />{tag.label}</label>)}</div>
                </fieldset>
                <Button type="submit" name="intent" value="save" variant="outline">入力した内容を保存</Button>
              </ActionForm>
            </div>
          </details>
        </> : <>
          <ProfileContent fields={version.fields_json} short={version.summary_short} long={version.summary_long} tags={chosenTags} />
          <ActionForm key={`revision:${version.updated_at}`} action={reviewAction} successText="新しい版を作りました。">
            <input type="hidden" name="versionId" value={version.id} />
            <Button type="submit" name="intent" value="revision">新しい版を作って直す</Button>
          </ActionForm>
        </>}
      </section>
    })}
    {interview?.status === 'done' && <GenerateForm consented={consented} again={cards.length > 0} />}
  </main>
}
