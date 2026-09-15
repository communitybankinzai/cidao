'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CONSENT_TEXTS, hasConsent, recordConsent } from '@/lib/consents'
import { currentInterview } from '@/lib/talent-bank/interview/access'
import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import { sessionMember } from '@/lib/talent-bank/profile/access'
import { generateProfileDraft } from '@/lib/talent-bank/profile/generate'
import { createRevision, updateDraft } from '@/lib/talent-bank/profile/review'
import { notifyAdminsOfApplication, unpublish } from '@/lib/talent-bank/profile/publish'
import { ProfileError } from '@/lib/talent-bank/profile/validation'
import { createClient } from '@/lib/supabase/server'
import { ownerRespondVideo, requestVideo, retireVideo, setFaceMode } from '@/lib/talent-bank/video/jobs'

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
