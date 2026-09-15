import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CONSENT_TEXTS, hasConsent } from '@/lib/consents'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { currentInterview } from '@/lib/talent-bank/interview/access'
import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import { reviewAction } from './actions'
import ActionForm from './_components/ActionForm'
import GenerateForm from './_components/GenerateForm'
import ProfileContent from './_components/ProfileContent'

export const maxDuration = 60
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
  return <main className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6">
    <nav><Link href="/talent" className="text-sm underline">← 人材バンク</Link></nav>
    <h1 className="text-2xl font-semibold">プロフィールの確認・編集</h1>
    <p className="text-sm text-muted-foreground">住所・電話番号・メールアドレスは記載しないでください。連絡は声がけから届きます。</p>
    {!cards.length && <p>インタビューが完了したら、プロフィール案を作成できます。<Link href="/talent/interview" className="underline">インタビューへ</Link></p>}
    {cards.length > 0 && (() => {
      const v = cards[0].version
      const step = !v ? 0 : v.status === 'published' ? 4 : v.status === 'owner_reviewed' ? 3 : 2
      const steps = ['インタビュー', 'プロフィール案の作成', '内容を確認・修正して「公開を申請」', '運営（CBI）の確認', '公開']
      return <section aria-label="進み具合" className="space-y-2 rounded-xl border border-sky-600 bg-sky-50 p-4 text-sm dark:bg-sky-950">
        <ol className="space-y-1">{steps.map((label, i) => <li key={label} className={i === step ? 'font-semibold' : i < step ? 'text-muted-foreground line-through' : 'text-muted-foreground'}>
          {i < step ? '✓' : i === step ? '▶' : '・'} {label}</li>)}</ol>
        <p>{step === 2 ? 'いまは「確認・修正」の段階です。下の内容を読み、違うところだけ直してから、いちばん下の「この内容で公開を申請」を押してください。直すところが無ければ、そのまま押して大丈夫です。'
          : step === 3 ? '申請を受け付けました。運営が確認して公開します。結果はベル通知でお知らせします。'
          : step === 4 ? '公開中です。直したいときは「新しい版を作って編集」から。' : ''}</p>
      </section>
    })()}
    {cards.map(({ profile, version, selected, versions }) => version && <section key={`${profile.id}:${version.updated_at}`} className="space-y-4">
      <h2 className="text-xl font-medium">{version.fields_json.display_name?.value ?? 'プロフィール'} · 第{version.version}版</h2>
      <p role="status">{({ draft: '編集中', owner_reviewed: '本人確認済み・運営確認待ち', approved: '運営承認済み', published: '公開中', retired: '公開停止・旧版' })[version.status]}</p>
      {version.rejected_reason && <p className="rounded border border-amber-500 p-3">差し戻し理由：{version.rejected_reason}</p>}
      {profile.current_version_id && <div className="space-y-3 rounded border p-4"><p>公開中：第{versions.find(v => v.id === profile.current_version_id)?.version}版（{profile.public_scope === 'public' ? '一般公開' : profile.public_scope === 'registered_only' ? '会員のみ' : '非公開'}）</p>
        <Link href={`/talent/${profile.member_id}?subject=${profile.subject_id}`} className="text-sm underline">表示を確認</Link>
        <ActionForm action={reviewAction}><input type="hidden" name="profileId" value={profile.id} /><Button name="intent" value="unpublish" variant="outline">公開を停止</Button></ActionForm>
      </div>}
      {['draft', 'owner_reviewed'].includes(version.status) ? <ActionForm action={reviewAction}>
        <input type="hidden" name="versionId" value={version.id} />
        <input type="hidden" name="expectedUpdatedAt" value={version.updated_at} />
        <label className="block space-y-2"><span>短い紹介（80字以内）</span><textarea name="summary_short" maxLength={80} defaultValue={version.summary_short ?? ''} rows={2} className="w-full rounded border bg-background p-3" /></label>
        <label className="block space-y-2"><span>詳しい紹介（400字以内）</span><textarea name="summary_long" maxLength={400} defaultValue={version.summary_long ?? ''} rows={6} className="w-full rounded border bg-background p-3" /></label>
        {INTERVIEW_FIELDS.map(f => {
          const item = version.fields_json[f.field_key]
          return <fieldset key={f.field_key} className="space-y-2 rounded border p-4"><legend className="px-1 font-medium">{f.label}{f.required && '（必須）'}</legend>
            <p className="text-xs text-muted-foreground">{item?.source === 'owner' ? '自分で編集' : '回答から'}</p>
            <label className="block text-sm">回答の状態<select name={`${f.field_key}:state`} defaultValue={item?.state ?? 'unknown'} className="mt-1 block w-full rounded border bg-background p-2">
              <option value="answered">回答する</option><option value="none">該当なし</option><option value="declined">答えない</option><option value="unknown">未回答</option>
            </select></label>
            <label className="block text-sm">内容<textarea name={`${f.field_key}:value`} maxLength={2000} defaultValue={item?.value ?? ''} rows={3} className="mt-1 w-full rounded border bg-background p-3" /></label>
          </fieldset>
        })}
        <fieldset className="rounded border p-4"><legend>タグ</legend><div className="flex flex-wrap gap-3">{tags.data?.map(tag => <label key={tag.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="tag" value={tag.id} defaultChecked={selected.has(tag.id)} />{tag.label}</label>)}</div></fieldset>
        <label className="block">公開範囲<select name="public_scope" defaultValue={version.public_scope} className="mt-2 block w-full rounded border bg-background p-3"><option value="private">非公開</option><option value="registered_only">CiDAOログイン会員のみ</option><option value="public">一般公開</option></select></label>
        <p className="text-sm text-muted-foreground">修正後は本人確認と運営承認が必要です。「該当なし」「答えない」は必須項目でも選べます。</p>
        <div className="flex flex-wrap gap-3"><Button name="intent" value="save" variant="outline">編集を保存</Button><Button name="intent" value="approve">この内容で公開を申請</Button></div>
      </ActionForm> : <><ProfileContent fields={version.fields_json} short={version.summary_short} long={version.summary_long} tags={(tags.data ?? []).filter(t => selected.has(t.id))} provenance />
        <ActionForm action={reviewAction}><input type="hidden" name="versionId" value={version.id} /><Button name="intent" value="revision">新しい版を作って編集</Button></ActionForm></>}
    </section>)}
    {interview?.status === 'done' && <GenerateForm consented={consented} again={cards.length > 0} />}
  </main>
}
