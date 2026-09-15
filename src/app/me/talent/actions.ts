'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CONSENT_TEXTS, hasConsent, recordConsent } from '@/lib/consents'
import { currentInterview } from '@/lib/talent-bank/interview/access'
import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import { sessionMember } from '@/lib/talent-bank/profile/access'
import { generateProfileDraft, generateProfileFromText } from '@/lib/talent-bank/profile/generate'
import { registrationSubject } from '@/lib/talent-bank/interview/access'
import { createTalentBankServiceClient } from '@/lib/talent-bank/db'
import { createRevision, updateDraft } from '@/lib/talent-bank/profile/review'
import { notifyAdminsOfApplication, unpublish } from '@/lib/talent-bank/profile/publish'
import { ProfileError } from '@/lib/talent-bank/profile/validation'
import { createClient } from '@/lib/supabase/server'
import { ownerRespondVideo, requestVideo, retireVideo, setFaceMode } from '@/lib/talent-bank/video/jobs'
import { ownerRespondIntro, ownerRetireIntro } from '@/lib/talent-bank/cbi-intro'

function refresh() {
  for (const p of ['/me/talent', '/talent', '/admin/talent-bank', '/talent/interview']) revalidatePath(p)
  revalidatePath('/talent/[id]', 'page')
}
function failure(error: unknown) {
  const messages: Record<string, string> = {
    consent_required: 'プロフィール作成への同意が必要です。', interview_not_done: '先にインタビューを完了してください。',
    required_fields_missing: '必須項目に未回答があります。回答・該当なし・答えないのいずれかを選んでください。',
    immutable_version: 'この版は編集できません。新しい版を作成してください。', invalid_text: '文字数と入力内容を確認してください。',
    stale_version: '新しい編集中の版があります。画面を読み直してください。', save_conflict: '内容が更新されています。画面を読み直してください。',
  }
  return { error: error instanceof ProfileError ? messages[error.reason] ?? '処理できませんでした。入力と状態を確認してください。' : '処理できませんでした。時間をおいて再度お試しください。' }
}
export async function generateAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const interview = await currentInterview(memberId)
    if (!interview || interview.status !== 'done') throw new ProfileError('interview_not_done')
    if (!await hasConsent({ memberId, subjectId: interview.subject_id, kind: 'profile', version: CONSENT_TEXTS.profile.version })) {
      if (form.get('consent') !== 'yes') throw new ProfileError('consent_required')
      await recordConsent({ memberId, subjectId: interview.subject_id, kind: 'profile' })
    }
    await generateProfileDraft({ memberId, interviewId: interview.id })
  } catch (error) { return failure(error) }
  refresh(); redirect('/me/talent')
}
export async function reviewAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const versionId = String(form.get('versionId') ?? '')
    const intent = form.get('intent')
    if (intent === 'revision') await createRevision({ memberId, versionId })
    else if (intent === 'unpublish') await unpublish({ memberId, profileId: String(form.get('profileId') ?? ''), reason: '本人による公開停止' })
    else {
      // フォームに含まれている項目だけを反映する。申請ボタンだけの小さいフォームから送っても、
      // 送られていない項目を「未回答」で上書きしない。タグは tags_present がある時だけ置き換える。
      const has = (k: string) => form.has(k)
      await updateDraft({ memberId, versionId, expectedUpdatedAt: String(form.get('expectedUpdatedAt') ?? '') || undefined, approve: intent === 'approve', patch: {
        ...(has('summary_short') ? { summary_short: String(form.get('summary_short')) } : {}),
        ...(has('summary_long') ? { summary_long: String(form.get('summary_long')) } : {}),
        ...(has('public_scope') ? { public_scope: String(form.get('public_scope')) } : {}),
        ...(has('tags_present') ? { tag_ids: form.getAll('tag').map(String) } : {}),
        fields: Object.fromEntries(INTERVIEW_FIELDS.filter(f => has(`${f.field_key}:state`) || has(`${f.field_key}:value`)).map(f => [f.field_key, {
          ...(has(`${f.field_key}:state`) ? { state: String(form.get(`${f.field_key}:state`)) } : {}),
          ...(has(`${f.field_key}:value`) ? { value: String(form.get(`${f.field_key}:value`)) } : {}),
        }])),
      } })
      // 申請が成立したら運営全員へ知らせる（失敗しても申請は成立したまま）。
      if (intent === 'approve') await notifyAdminsOfApplication(versionId)
    }
  } catch (error) { refresh(); return failure(error) }
  refresh(); return { error: '' }
}
// 「自分で書く」入口（2026-09-15 一本化）：自己紹介の文章から AI が紹介文の案を作る。18歳以上の本人確認と同意はここで記録する
export async function writeAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    if (form.get('adult') !== 'yes') return { error: '18歳以上の本人（店舗・団体は代表者本人）であることを確認してください。' }
    const subject = await registrationSubject(memberId)
    if (!subject.is_adult_confirmed) {
      const r = await createTalentBankServiceClient().from('talent_subjects').update({ is_adult_confirmed: true }).eq('id', subject.id).eq('owner_member_id', memberId)
      if (r.error) throw new ProfileError('storage_unavailable')
    }
    for (const kind of ['profile', 'external_ai'] as const) {
      if (!await hasConsent({ memberId, subjectId: subject.id, kind, version: CONSENT_TEXTS[kind].version })) {
        if (form.get('consent') !== 'yes') throw new ProfileError('consent_required')
        await recordConsent({ memberId, subjectId: subject.id, kind })
      }
    }
    await generateProfileFromText({ memberId, subjectId: subject.id, text: String(form.get('text') ?? '') })
  } catch (error) {
    if (error instanceof ProfileError && error.reason === 'invalid_text') return { error: '自己紹介は20〜4000字で書いてください。' }
    return failure(error)
  }
  refresh(); return { error: '' }
}
// 公開の設定（2026-09-15 一本化）：公開範囲・声がけ受付。公開範囲は公開中のプロフィールにそのまま効く（承認のやり直しは不要）
export async function settingsAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId, db } = await sessionMember()
    const intent = String(form.get('intent') ?? '')
    if (intent === 'scope') {
      const value = String(form.get('public_scope') ?? '')
      if (value !== 'public' && value !== 'registered_only') throw new ProfileError('invalid_scope')
      const service = createTalentBankServiceClient()
      const profile = await service.from('talent_profiles').select('id, current_version_id').eq('member_id', memberId).maybeSingle()
      if (profile.error || !profile.data?.current_version_id) throw new ProfileError('profile_not_published')
      const results = await Promise.all([
        service.from('talent_profiles').update({ public_scope: value }).eq('id', profile.data.id),
        service.from('talent_profile_versions').update({ public_scope: value }).eq('id', profile.data.current_version_id),
        service.from('publications').update({ scope: value }).eq('profile_id', profile.data.id).is('unpublished_at', null),
      ])
      if (results.some(r => r.error)) throw new ProfileError('storage_unavailable')
    } else if (intent === 'acceptance') {
      const value = String(form.get('message_acceptance') ?? '')
      if (!['open', 'recommended_only', 'closed'].includes(value)) throw new ProfileError('invalid_scope')
      // 声がけ受付は従来どおり member_profiles_pr に置く（声がけの送信可否がこの表を見ているため）。本人の権限で自分の行だけ
      const r = await db.from('member_profiles_pr').upsert({ member_id: memberId, message_acceptance: value as 'open' | 'recommended_only' | 'closed' }, { onConflict: 'member_id' })
      if (r.error) throw new ProfileError('storage_unavailable')
    } else throw new ProfileError('invalid_intent')
  } catch (error) { refresh(); return failure(error) }
  refresh(); return { error: '' }
}
// 紹介動画（2026-09-15）：顔の見せ方・作り直し・本人の確認・掲載の取り下げ
export async function videoAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const intent = String(form.get('intent') ?? '')
    const videoId = String(form.get('videoId') ?? '')
    if (intent === 'face_mode') await setFaceMode({ memberId, faceMode: form.get('face_mode') === 'no_face' ? 'no_face' : 'photo' })
    else if (intent === 'request') await requestVideo(memberId)
    else if (intent === 'approve') await ownerRespondVideo({ memberId, videoId, approve: true })
    else if (intent === 'redo') await ownerRespondVideo({ memberId, videoId, approve: false, comment: String(form.get('comment') ?? '') })
    else if (intent === 'retire') await retireVideo({ actorId: memberId, videoId, asAdmin: false })
    else throw new ProfileError('invalid_intent')
  } catch (error) {
    const messages: Record<string, string> = {
      photos_required: '先に写真を1枚以上登録してください。', profile_not_published: 'プロフィールが公開されてから動画を作れます。',
      video_in_progress: 'いま作っている最中です。できるまでお待ちください（10〜20分）。', daily_limit: '作り直しは1日3回までです。明日またお試しください。',
      stale_version: '状態が変わっています。画面を読み直してください。',
    }
    if (error instanceof ProfileError && messages[error.reason]) { refresh(); return { error: messages[error.reason] } }
    refresh(); return failure(error)
  }
  refresh(); return { error: '' }
}
// 他己紹介（2026-09-15）：本人が「このまま載せる」「直してほしい点を書いて戻す」「取り下げる」
export async function introAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const intent = String(form.get('intent') ?? '')
    if (intent === 'approve') await ownerRespondIntro({ memberId, approve: true })
    else if (intent === 'return') await ownerRespondIntro({ memberId, approve: false, comment: String(form.get('comment') ?? '') })
    else if (intent === 'retire') await ownerRetireIntro(memberId)
    else throw new ProfileError('invalid_intent')
  } catch (error) {
    const messages: Record<string, string> = { reason_required: '直してほしい点を書いてください。', stale_version: '状態が変わっています。画面を読み直してください。' }
    refresh(); return { error: error instanceof ProfileError && messages[error.reason] ? messages[error.reason] : '処理できませんでした。時間をおいて再度お試しください。' }
  }
  refresh(); return { error: '' }
}
// 紹介ページに「活動の足あと」を出すか（本人の設定・2026-09-15）。本人の権限（RLS）で自分の行だけを更新する。
export async function footprintsAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const db = await createClient()
    const { error } = await db.from('members').update({ show_footprints: form.get('show') === 'yes' }).eq('id', memberId)
    if (error) throw error
  } catch { return { error: '設定を保存できませんでした。時間をおいて再度お試しください。' } }
  refresh(); return { error: '' }
}
