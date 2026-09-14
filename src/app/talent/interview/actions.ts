'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getOrCreateSelfSubject, recordConsent } from '@/lib/consents'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { currentInterview, InterviewError, registrationSubject } from '@/lib/talent-bank/interview/access'
import { interviewErrorMessage } from '@/lib/talent-bank/interview/errors'
import { startOrResumeInterview } from '@/lib/talent-bank/interview/start'

type FormState = { error: string | null }
async function authenticated() {
  const db = await createTalentBankClient()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) throw new InterviewError('unauthorized')
  return { db, memberId: data.user.id }
}
export async function confirmEligibility(_previous: FormState, form: FormData): Promise<FormState> {
  try {
    const { db, memberId } = await authenticated()
    const type = form.get('subject_type')
    const name = String(form.get('display_name') ?? '').trim()
    if (!['person', 'shop', 'org'].includes(String(type)) || !name || name.length > 100 ||
        form.get('adult') !== 'on' || (type !== 'person' && form.get('representative') !== 'on')) {
      return { error: '表示名と種別を入力し、18歳以上の本人（店舗・団体では代表者本人）であることを確認してください。' }
    }
    // Registration is immutable once an interview exists in this phase.
    if (await currentInterview(memberId)) return { error: '受付済みです。画面を再読み込みしてください。' }
    const self = await getOrCreateSelfSubject(memberId)
    const existing = await db.from('talent_subjects').select('*').eq('owner_member_id', memberId)
      .eq('subject_type', type as 'person' | 'shop' | 'org').order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (existing.error) throw new InterviewError('storage_unavailable')
    const id = type === 'person' ? self.id : existing.data?.id
    const value = { display_name: name, is_adult_confirmed: true, subject_type: type as 'person' | 'shop' | 'org' }
    const saved = id ? await db.from('talent_subjects').update(value).eq('id', id).eq('owner_member_id', memberId).select('id').single() :
      await db.from('talent_subjects').insert({ ...value, owner_member_id: memberId }).select('id').single()
    if (saved.error || !saved.data) throw new InterviewError('storage_unavailable')
  } catch (error) {
    return { error: interviewErrorMessage(error instanceof InterviewError ? error.reason : 'storage_unavailable') }
  }
  revalidatePath('/talent/interview')
  redirect('/talent/interview')
}
export async function consentAndStart(_previous: FormState, form: FormData): Promise<FormState> {
  try {
    const { memberId } = await authenticated()
    if (form.get('agree') !== 'on') return { error: '両方の同意文をご確認のうえ、同意にチェックしてください。' }
    const existing = await currentInterview(memberId)
    const subject = await registrationSubject(memberId)
    const subjectId = existing?.subject_id ?? subject.id
    const { db } = await authenticated()
    const eligible = await db.from('talent_subjects').select('is_adult_confirmed').eq('id', subjectId).eq('owner_member_id', memberId).single()
    if (eligible.error || !eligible.data?.is_adult_confirmed) throw new InterviewError('eligibility_required')
    await recordConsent({ memberId, subjectId, kind: 'interview' })
    await recordConsent({ memberId, subjectId, kind: 'external_ai' })
    await startOrResumeInterview({ memberId })
  } catch (error) {
    return { error: interviewErrorMessage(error instanceof InterviewError ? error.reason : 'storage_unavailable') }
  }
  revalidatePath('/talent/interview')
  redirect('/talent/interview')
}
