import 'server-only'
import { InterviewError, assertEligible, memberClient, registrationSubject } from './access'
import { INITIAL_MESSAGE } from './config'
import { interviewSnapshot } from './snapshot'
import type { Interview } from '../types'

export async function startOrResumeInterview({ memberId }: { memberId: string }) {
  const subject = await registrationSubject(memberId)
  const db = await memberClient(memberId)
  const find = async (status: Interview['status']) => {
    const result = await db.from('interviews').select('*').eq('member_id', memberId).eq('kind', 'talent')
      .eq('status', status).order('last_activity_at', { ascending: false }).limit(1).maybeSingle()
    if (result.error) throw new InterviewError('storage_unavailable')
    return result.data
  }
  let interview = await find('active') ?? await find('paused') ?? await find('done')
  await assertEligible(memberId, interview?.subject_id ?? subject.id)
  if (interview?.status === 'paused') {
    const resumed = await db.from('interviews').update({ status: 'active', last_activity_at: new Date().toISOString() })
      .eq('id', interview.id).eq('member_id', memberId).eq('status', 'paused').select('*').maybeSingle()
    if (resumed.error && resumed.error.code !== '23505') throw new InterviewError('storage_unavailable')
    interview = resumed.data ?? await find('active')
    if (!interview) throw new InterviewError('conflict')
    await assertEligible(memberId, interview.subject_id)
  }
  if (!interview) {
    const inserted = await db.from('interviews').insert({ subject_id: subject.id, member_id: memberId, kind: 'talent' })
      .select('*').single()
    if (inserted.error && inserted.error.code !== '23505') throw new InterviewError('storage_unavailable')
    interview = inserted.data ?? await find('active')
    if (!interview) throw new InterviewError('conflict')
    await assertEligible(memberId, interview.subject_id)
  }
  // Repair a partially failed start; the unique seq prevents duplicate greetings.
  // Do not recreate expired original messages on old interviews.
  if (interview.turn_count === 0 && interview.status === 'active' &&
      Date.parse(interview.created_at) > Date.now() - 365 * 86400_000) {
    const greeting = await db.from('interview_messages').insert({
      interview_id: interview.id, seq: 0, role: 'assistant', content: INITIAL_MESSAGE,
    })
    if (greeting.error && greeting.error.code !== '23505') throw new InterviewError('storage_unavailable')
  }
  return interviewSnapshot(interview, memberId)
}
