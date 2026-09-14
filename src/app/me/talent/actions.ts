'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CONSENT_TEXTS, hasConsent, recordConsent } from '@/lib/consents'
import { currentInterview } from '@/lib/talent-bank/interview/access'
import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import { sessionMember } from '@/lib/talent-bank/profile/access'
import { generateProfileDraft } from '@/lib/talent-bank/profile/generate'
import { createRevision, updateDraft } from '@/lib/talent-bank/profile/review'
import { unpublish } from '@/lib/talent-bank/profile/publish'
import { ProfileError } from '@/lib/talent-bank/profile/validation'

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
      await updateDraft({ memberId, versionId, expectedUpdatedAt: String(form.get('expectedUpdatedAt') ?? ''), approve: intent === 'approve', patch: {
        summary_short: String(form.get('summary_short') ?? ''), summary_long: String(form.get('summary_long') ?? ''),
        public_scope: String(form.get('public_scope') ?? ''), tag_ids: form.getAll('tag').map(String),
        fields: Object.fromEntries(INTERVIEW_FIELDS.map(f => [f.field_key, {
          state: String(form.get(`${f.field_key}:state`) ?? 'unknown'), value: String(form.get(`${f.field_key}:value`) ?? ''),
        }])),
      } })
    }
  } catch (error) { refresh(); return failure(error) }
  refresh(); return { error: '' }
}
