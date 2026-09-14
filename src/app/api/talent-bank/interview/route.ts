import { NextResponse } from 'next/server'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { currentInterview, InterviewError } from '@/lib/talent-bank/interview/access'
import { MAX_USER_TEXT_LENGTH } from '@/lib/talent-bank/interview/config'
import { pauseInterview } from '@/lib/talent-bank/interview/pause'
import { allowInterviewRequest } from '@/lib/talent-bank/interview/rate-limit'
import { interviewSnapshot } from '@/lib/talent-bank/interview/snapshot'
import { startOrResumeInterview } from '@/lib/talent-bank/interview/start'
import { runInterviewTurn } from '@/lib/talent-bank/interview/turn'

export const maxDuration = 60

export async function POST(request: Request) {
  // Same failure convention as /api/events/scan: expected/AI failures use HTTP
  // 200 + ok:false. Authentication is the explicit 401 exception.
  const fail = (reason: string) => NextResponse.json({ ok: false, reason })
  try {
    const db = await createTalentBankClient()
    const { data, error } = await db.auth.getUser()
    if (error || !data.user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
    const memberId = data.user.id
    if (!allowInterviewRequest(memberId)) return fail('rate_limited')
    // The browser sends same-origin JSON; reject explicit cross-origin requests.
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return fail('invalid_origin')
    let body: unknown
    try { body = await request.json() } catch { return fail('invalid_request') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_request')
    const { action, text } = body as Record<string, unknown>
    if (action === 'start') return NextResponse.json({ ok: true, data: await startOrResumeInterview({ memberId }) })
    if (action !== 'turn' && action !== 'pause') return fail('invalid_request')
    if (action === 'turn' && (typeof text !== 'string' || !text.trim() || text.length > MAX_USER_TEXT_LENGTH)) return fail('invalid_text')
    // Never trust a client-supplied member/interview ID. Phase 2 has one talent interview.
    const interview = await currentInterview(memberId)
    if (!interview) return fail('interview_not_found')
    if (action === 'pause') return NextResponse.json({ ok: true, data: await pauseInterview({ interviewId: interview.id, memberId }) })
    const result = await runInterviewTurn({ interviewId: interview.id, memberId, userText: text as string })
    const latest = await currentInterview(memberId)
    const snapshot = latest ? await interviewSnapshot(latest, memberId) : undefined
    if ('error' in result) return NextResponse.json({ ok: false, reason: result.error, data: snapshot })
    return NextResponse.json({ ok: true, data: snapshot, ...result })
  } catch (error) {
    return fail(error instanceof InterviewError ? error.reason : 'storage_unavailable')
  }
}
