import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CONSENT_TEXTS, hasConsent } from '@/lib/consents'
import { createClient } from '@/lib/supabase/server'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { currentInterview } from '@/lib/talent-bank/interview/access'
import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import { ownIntro } from '@/lib/talent-bank/cbi-intro'
import { listOwnVideos, listPhotos, photoUrl } from '@/lib/talent-bank/video/jobs'
import { footprintsAction, reviewAction, settingsAction, writeAction } from './actions'
import ActionForm from './_components/ActionForm'
import EditChat from './_components/EditChat'
import GenerateForm from './_components/GenerateForm'
import IntroSection from './_components/IntroSection'
import ProfileContent from './_components/ProfileContent'
import VideoSection from './_components/VideoSection'

const SCOPE_LABEL = { registered_only: 'CiDAO にログインした会員だけ', public: '一般公開（だれでも見られる）', private: '非公開（自分と運営だけ）' } as const
const STATUS_LABEL = { draft: '確認中（まだ公開されていません）', owner_reviewed: '公開申請中（運営の確認待ち）', approved: '運営承認済み', published: '公開中', retired: '公開停止・旧版' } as const
const ACCEPT_LABEL = { open: '誰からでも受け付ける', recommended_only: 'AI のマッチング経由だけ受け付ける', closed: '受け付けない' } as const
const box = 'space-y-4 rounded-xl border p-4'

export const maxDuration = 60
// 2026-09-15 一本化（中司さん決定・案A）：従来の「公開PR」とAIインタビュー版を1画面にまとめ、箱を4つに絞った。
// ①紹介文 ②写真と動画 ③公開の設定 ④CBIからの他己紹介。進み具合の箱・版番号・20項目の入力欄は畳んだ。
export default async function MyTalentPage() {
  const db = await createTalentBankClient()
  const { data } = await db.auth.getUser()
  if (!data.user) redirect('/login?next=/me/talent')
  const memberId = data.user.id
  const plain = await createClient()
  const [profiles, tags, interview, me, pr, photoRows, videos, intro] = await Promise.all([
    db.from('talent_profiles').select('*').eq('member_id', memberId).order('updated_at', { ascending: false }).limit(1),
    db.from('talent_tags').select('*').order('label'), currentInterview(memberId),
    plain.from('members').select('show_footprints').eq('id', memberId).maybeSingle(),
    plain.from('member_profiles_pr').select('message_acceptance').eq('member_id', memberId).maybeSingle(),
    listPhotos(memberId), listOwnVideos(memberId), ownIntro(memberId),
  ])
  if (profiles.error || tags.error) throw new Error('Profile unavailable')
  const profile = profiles.data?.[0] ?? null
  const versions = profile ? await db.from('talent_profile_versions').select('*').eq('profile_id', profile.id).order('version', { ascending: false }) : { data: [], error: null }
  if (versions.error) throw new Error('Profile unavailable')
  const version = versions.data?.find(v => v.id === profile?.draft_version_id) ?? versions.data?.find(v => v.id === profile?.current_version_id) ?? versions.data?.[0] ?? null
  const links = version ? await db.from('talent_profile_version_tags').select('tag_id').eq('version_id', version.id) : { data: [], error: null }
  if (links.error) throw new Error('Profile unavailable')
  const selected = new Set((links.data ?? []).map(t => t.tag_id))
  const chosenTags = (tags.data ?? []).filter(t => selected.has(t.id))
  const consented = interview ? await hasConsent({ memberId, subjectId: interview.subject_id, kind: 'profile', version: CONSENT_TEXTS.profile.version }) : false
  const photos = await Promise.all(photoRows.map(async p => ({ id: p.id, url: await photoUrl(p.path) })))
  const showFootprints = me.data?.show_footprints !== false
  const published = !!profile?.current_version_id
  const editable = version?.status === 'draft' || version?.status === 'owner_reviewed'

  return <main className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6">
    <nav className="flex gap-4 text-sm"><Link href="/me" className="underline">← マイページ</Link><Link href="/talent" className="underline">登録メンバー一覧</Link>{published && <Link href={`/talent/${memberId}`} className="underline">自分の紹介ページ</Link>}</nav>
    <h1 className="text-2xl font-semibold">人材バンク</h1>

    {/* ① 紹介文 */}
    <section aria-label="紹介文" className={box}>
      <h2 className="text-lg font-semibold">1. 紹介文</h2>
      {!version && <>
        <p className="text-sm text-muted-foreground">自己紹介を書くと、AI が人材バンク向けの紹介文に整えます。できた案はあなたが確認し、公開を申請すると運営が確認して掲載します。</p>
        {interview?.status === 'done' ? <GenerateForm consented={consented} /> : <>
          <ActionForm action={writeAction} successText="紹介文の案ができました。画面を読み直して確認してください。">
            <label className="block text-sm">自己紹介（活動していること・できること・相談を受けられること・大切にしていること など、自由に）
              <textarea name="text" required minLength={20} maxLength={4000} rows={8} className="mt-2 w-full rounded border bg-background p-3 font-normal" placeholder="例：印西市で革小物をつくって販売しています。平日の昼間なら、ものづくり体験の相談に乗れます。" />
            </label>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="adult" value="yes" required className="mt-1" />18歳以上の本人（店舗・団体は代表者本人）です</label>
            <details className="text-sm"><summary className="cursor-pointer">同意の内容を読む</summary><p className="mt-2 text-muted-foreground">{CONSENT_TEXTS.profile.text}</p><p className="mt-2 text-muted-foreground">{CONSENT_TEXTS.external_ai.text}</p></details>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" value="yes" required className="mt-1" />上の内容に同意します</label>
            <Button type="submit" className="w-full">AI に紹介文の案を作ってもらう</Button>
          </ActionForm>
          <p className="text-sm text-muted-foreground">文章を書くより質問に答える方が楽な人は <Link href="/talent/interview" className="underline">AI インタビュー</Link> からでも作れます。</p>
        </>}
      </>}
      {version && profile && <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span role="status" className="rounded-full border px-3 py-1 text-xs">{STATUS_LABEL[version.status]}</span>
          {version.status === 'owner_reviewed' && <span className="text-muted-foreground">運営が確認すると公開され、ベルでお知らせします。</span>}
        </div>
        {version.rejected_reason && <p className="rounded border border-amber-500 p-3 text-sm">運営からの修正のお願い：{version.rejected_reason}</p>}
        <ProfileContent key={version.updated_at} fields={version.fields_json} short={version.summary_short} long={version.summary_long} tags={chosenTags} />
        {editable ? <>
          <EditChat key={version.id} versionId={version.id} missing={INTERVIEW_FIELDS.filter(f => !f.required && (version.fields_json[f.field_key]?.state ?? 'unknown') === 'unknown').map(f => f.label)} />
          <ActionForm key={`apply:${version.updated_at}`} action={reviewAction} successText="申請しました。運営が確認して公開します。">
            <input type="hidden" name="versionId" value={version.id} />
            <label className="block text-sm font-medium">公開する範囲
              <select name="public_scope" defaultValue={version.public_scope === 'private' ? 'registered_only' : version.public_scope} className="mt-2 block w-full rounded border bg-background p-3 font-normal">
                {(['registered_only', 'public'] as const).map(value => <option key={value} value={value}>{SCOPE_LABEL[value]}</option>)}
              </select>
            </label>
            <Button type="submit" name="intent" value="approve" className="w-full">{version.status === 'owner_reviewed' ? 'この内容で申請し直す' : 'この内容で公開を申請'}</Button>
          </ActionForm>
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer">項目ごとに自分で直す</summary>
            <div className="mt-3">
              <ActionForm key={`detail:${version.updated_at}`} action={reviewAction}>
                <input type="hidden" name="versionId" value={version.id} /><input type="hidden" name="tags_present" value="1" />
                <p className="text-muted-foreground">空にした項目は「未回答」になり、公開されません。</p>
                <label className="block space-y-2"><span>短い紹介（80字以内）</span><textarea name="summary_short" maxLength={80} defaultValue={version.summary_short ?? ''} rows={2} className="w-full rounded border bg-background p-3" /></label>
                <label className="block space-y-2"><span>詳しい紹介（400字以内）</span><textarea name="summary_long" maxLength={400} defaultValue={version.summary_long ?? ''} rows={6} className="w-full rounded border bg-background p-3" /></label>
                {INTERVIEW_FIELDS.map(f => {
                  const item = version.fields_json[f.field_key]
                  return <fieldset key={f.field_key} className="space-y-2 rounded border p-3">
                    <legend className="px-1 font-medium">{f.label}{f.required && '（必須）'}</legend>
                    <textarea name={`${f.field_key}:value`} maxLength={2000} defaultValue={item?.value ?? ''} rows={2} className="w-full rounded border bg-background p-2" />
                    <label className="block text-xs text-muted-foreground">空欄のときの扱い
                      <select name={`${f.field_key}:state`} defaultValue={item?.state === 'none' || item?.state === 'declined' ? item.state : 'unknown'} className="ml-2 rounded border bg-background p-1">
                        <option value="unknown">未回答</option><option value="none">該当なし</option><option value="declined">載せない</option>
                      </select>
                    </label>
                  </fieldset>
                })}
                <fieldset className="rounded border p-3"><legend className="px-1 font-medium">タグ</legend>
                  <div className="flex flex-wrap gap-3">{tags.data?.map(tag => <label key={tag.id} className="flex items-center gap-2"><input type="checkbox" name="tag" value={tag.id} defaultChecked={selected.has(tag.id)} />{tag.label}</label>)}</div>
                </fieldset>
                <Button type="submit" name="intent" value="save" variant="outline">入力した内容を保存</Button>
              </ActionForm>
            </div>
          </details>
        </> : <ActionForm key={`revision:${version.updated_at}`} action={reviewAction} successText="新しい版を作りました。画面を読み直してください。">
          <input type="hidden" name="versionId" value={version.id} />
          <p className="text-sm text-muted-foreground">直したいときは新しい版を作ります。公開中の内容は、直した版が承認されるまでそのまま見えます。</p>
          <Button type="submit" name="intent" value="revision" variant="outline">紹介文を直す</Button>
        </ActionForm>}
      </>}
    </section>

    {/* ② 写真と動画 */}
    {profile && <VideoSection photos={photos} faceMode={profile.face_mode} videos={videos} published={published} />}

    {/* ③ 公開の設定 */}
    {profile && <section aria-label="公開の設定" className={box}>
      <h2 className="text-lg font-semibold">3. 公開の設定</h2>
      {published && <ActionForm key={`scope:${profile.updated_at}`} action={settingsAction} successText="公開範囲を変えました。">
        <input type="hidden" name="intent" value="scope" />
        <label className="block text-sm font-medium">紹介ページを見られる人
          <select name="public_scope" defaultValue={profile.public_scope === 'private' ? 'registered_only' : profile.public_scope} className="mt-2 block w-full rounded border bg-background p-3 font-normal">
            {(['registered_only', 'public'] as const).map(value => <option key={value} value={value}>{SCOPE_LABEL[value]}</option>)}
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">保存</Button>
      </ActionForm>}
      <ActionForm key={`accept:${pr.data?.message_acceptance ?? 'none'}`} action={settingsAction} successText="声がけの受付を変えました。">
        <input type="hidden" name="intent" value="acceptance" />
        <label className="block text-sm font-medium">声がけ（相談のメッセージ）の受付
          <select name="message_acceptance" defaultValue={pr.data?.message_acceptance ?? 'recommended_only'} className="mt-2 block w-full rounded border bg-background p-3 font-normal">
            {(['open', 'recommended_only', 'closed'] as const).map(value => <option key={value} value={value}>{ACCEPT_LABEL[value]}</option>)}
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">保存</Button>
      </ActionForm>
      <ActionForm key={`footprints:${showFootprints}`} action={footprintsAction} successText="設定を保存しました。">
        <input type="hidden" name="show" value={showFootprints ? 'no' : 'yes'} />
        <p className="text-sm font-medium">活動の足あと：{showFootprints ? '表示する' : '表示しない'}</p>
        <p className="text-sm text-muted-foreground">所属団体・出した提案・意見の数・主催したイベントを紹介ページに自動で並べます（CiDAO で公開されている記録だけ）。</p>
        <Button type="submit" variant="outline" size="sm">{showFootprints ? '足あとを隠す' : '足あとを表示する'}</Button>
      </ActionForm>
      {published && <ActionForm key={`unpublish:${profile.updated_at}`} action={reviewAction} successText="公開を停止しました。">
        <input type="hidden" name="profileId" value={profile.id} />
        <p className="text-sm text-muted-foreground">公開をやめたいときは、いつでも止められます（動画も紹介ページから消えます）。</p>
        <Button type="submit" name="intent" value="unpublish" variant="outline" size="sm">公開を停止</Button>
      </ActionForm>}
    </section>}

    {/* ④ CBI からの他己紹介 */}
    <IntroSection intro={intro} />
  </main>
}
