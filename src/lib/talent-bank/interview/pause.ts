import 'server-only'
import { InterviewError, isTurnInFlight, memberClient } from './access'

export async function pauseInterview({ interviewId, memberId }: { interviewId: string; memberId: string }) {
  const db = await memberClient(memberId)
  const { data, error } = await db.from('interviews').select('*').eq('id', interviewId)
    .eq('member_id', memberId).eq('kind', 'talent').maybeSingle()
  if (error) throw new InterviewError('storage_unavailable')
  if (!data) throw new InterviewError('interview_not_found')
  if (data.status === 'paused') return { status: 'paused' as const }
  if (data.status !== 'active') throw new InterviewError('not_active')
  if (isTurnInFlight(data)) throw new InterviewError('busy')
  const paused = await db.from('interviews').update({ status: 'paused', last_activity_at: new Date().toISOString() })
    .eq('id', interviewId).eq('member_id', memberId).eq('status', 'active').eq('updated_at', data.updated_at)
    .select('id').maybeSingle()
  if (paused.error) throw new InterviewError('storage_unavailable')
  if (!paused.data) throw new InterviewError('busy')
  return { status: 'paused' as const }
}
