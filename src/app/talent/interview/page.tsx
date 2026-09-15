import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CONSENT_TEXTS, hasConsent } from '@/lib/consents'
import GenerateForm from '@/app/me/talent/_components/GenerateForm'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { currentInterview, hasInterviewConsents } from '@/lib/talent-bank/interview/access'
import { interviewSnapshot } from '@/lib/talent-bank/interview/snapshot'
import { ConsentForm, EligibilityForm } from './_components/RegistrationForms'
import InterviewChat from './_components/InterviewChat'

export const maxDuration = 60
export default async function InterviewPage() {
  const db = await createTalentBankClient()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) redirect('/login?next=/talent/interview')
  const memberId = data.user.id
  const interview = await currentInterview(memberId)
  let query = db.from('talent_subjects').select('*').eq('owner_member_id', memberId)
  if (interview) query = query.eq('id', interview.subject_id)
  const subject = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (subject.error) throw new Error('Interview registration unavailable')
  const eligible = !!subject.data?.is_adult_confirmed
  const consented = eligible && !!subject.data && await hasInterviewConsents(memberId, subject.data.id)
  const snapshot = consented && interview ? await interviewSnapshot(interview, memberId) : null
  const done = interview?.status === 'done'
  const profileConsented = done && await hasConsent({ memberId, subjectId: interview.subject_id, kind: 'profile', version: CONSENT_TEXTS.profile.version })
  // 案がすでにあるときは作り直しボタンを出さない（2026-09-15、戻ってきて押し、意図せず新しい版が増えた）。
  const hasProfile = done && !!(await db.from('talent_profiles').select('id').eq('member_id', memberId).limit(1).maybeSingle()).data
  return <main className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6">
    <nav className="text-sm text-muted-foreground"><Link href="/talent" className="underline">← 登録メンバーへ</Link></nav>
    <header className="space-y-2"><p className="text-xs tracking-widest text-muted-foreground">CBI 人材バンク・試行版</p>
      <h1 className="text-2xl font-semibold">AIインタビューで登録</h1>
      <p className="text-sm text-muted-foreground">一つずつお聞きします。途中で保存して、後から続けられます。</p>
    </header>
    {hasProfile && <Link href="/me/talent" className="block rounded-xl border border-sky-600 bg-sky-50 p-4 font-medium dark:bg-sky-950">
      プロフィール案はできています。確認と公開の申請へ進む →</Link>}
    {!eligible ? <EligibilityForm displayName={subject.data?.display_name ?? ''} /> : !consented ?
      <ConsentForm texts={[
        { label: 'インタビュー・会話の保存', ...CONSENT_TEXTS.interview },
        { label: '外部AIの利用', ...CONSENT_TEXTS.external_ai },
      ]} /> : <InterviewChat initial={snapshot} />}
    {done && !hasProfile && <GenerateForm consented={!!profileConsented} />}
  </main>
}
