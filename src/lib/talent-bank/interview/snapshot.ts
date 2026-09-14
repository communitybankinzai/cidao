import 'server-only'
import type { Interview } from '../types'
import { InterviewError, memberClient } from './access'
import { interviewProgress, summarizeInterview } from './summary'

export async function interviewSnapshot(interview: Interview, memberId: string) {
  if (interview.member_id !== memberId) throw new InterviewError('unauthorized')
  const db = await memberClient(memberId)
  const { data, error } = await db.from('interview_messages').select('*')
    .eq('interview_id', interview.id).order('seq', { ascending: true })
  if (error) throw new InterviewError('storage_unavailable')
  return { interviewId: interview.id, status: interview.status, turn_count: interview.turn_count,
    messages: (data ?? []).filter(message => message.role !== 'system'),
    progress: interviewProgress(interview.collected_json), summary: summarizeInterview(interview.collected_json) }
}
export type InterviewSnapshot = Awaited<ReturnType<typeof interviewSnapshot>>
