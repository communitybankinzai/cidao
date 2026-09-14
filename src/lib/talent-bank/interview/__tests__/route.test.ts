import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST, maxDuration } from '@/app/api/talent-bank/interview/route'
import { createTalentBankClient } from '../../db'
import { currentInterview } from '../access'
import { allowInterviewRequest } from '../rate-limit'
import { interviewSnapshot } from '../snapshot'
import { startOrResumeInterview } from '../start'
import { runInterviewTurn } from '../turn'
import { pauseInterview } from '../pause'
import { interviewDB, interviewRow, memberId } from './mock-interview-db'

vi.mock('../../db', () => ({ createTalentBankClient: vi.fn() }))
vi.mock('../access', () => ({ currentInterview: vi.fn(), InterviewError: class extends Error { constructor(public reason: string) { super(reason) } } }))
vi.mock('../rate-limit', () => ({ allowInterviewRequest: vi.fn() }))
vi.mock('../snapshot', () => ({ interviewSnapshot: vi.fn() }))
vi.mock('../start', () => ({ startOrResumeInterview: vi.fn() }))
vi.mock('../turn', () => ({ runInterviewTurn: vi.fn() }))
vi.mock('../pause', () => ({ pauseInterview: vi.fn() }))
const snapshot = { interviewId: 'interview-1', status: 'active' as const, turn_count: 0, messages: [],
  progress: { required_done: 0, required_total: 8, optional_done: 0 }, summary: [] }
let db: ReturnType<typeof interviewDB>
const request = (body: unknown) => new Request('https://example.test/api/talent-bank/interview', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  db = interviewDB()
  vi.mocked(createTalentBankClient).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof createTalentBankClient>>)
  vi.mocked(currentInterview).mockResolvedValue(interviewRow())
  vi.mocked(allowInterviewRequest).mockReturnValue(true)
  vi.mocked(interviewSnapshot).mockResolvedValue(snapshot)
  vi.mocked(startOrResumeInterview).mockResolvedValue(snapshot)
  vi.mocked(runInterviewTurn).mockResolvedValue({ assistant_message: '質問', status: 'active', progress: snapshot.progress })
  vi.mocked(pauseInterview).mockResolvedValue({ status: 'paused' })
})
describe('interview API', () => {
  it('has the 60 second limit and returns 401 when unauthenticated', async () => {
    expect(maxDuration).toBe(60)
    db.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as unknown as Awaited<ReturnType<typeof db.auth.getUser>>)
    const response = await POST(request({ action: 'start' }))
    expect(response.status).toBe(401)
    expect(startOrResumeInterview).not.toHaveBeenCalled()
  })
  it('starts only as the authenticated member', async () => {
    const response = await POST(request({ action: 'start', memberId: 'attacker-selected-id' }))
    expect(await response.json()).toMatchObject({ ok: true })
    expect(startOrResumeInterview).toHaveBeenCalledWith({ memberId })
  })
  it('uses the server interview ID for turns and pause', async () => {
    await POST(request({ action: 'turn', interviewId: 'someone-else', text: '回答' }))
    expect(runInterviewTurn).toHaveBeenCalledWith({ interviewId: 'interview-1', memberId, userText: '回答' })
    await POST(request({ action: 'pause' }))
    expect(pauseInterview).toHaveBeenCalledWith({ interviewId: 'interview-1', memberId })
  })
  it('returns AI failure with saved conversation and HTTP 200', async () => {
    vi.mocked(runInterviewTurn).mockResolvedValue({ error: 'ai_unavailable' })
    const response = await POST(request({ action: 'turn', text: '回答' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: false, reason: 'ai_unavailable', data: snapshot })
  })
  it('rate limits before starting AI', async () => {
    vi.mocked(allowInterviewRequest).mockReturnValue(false)
    const response = await POST(request({ action: 'turn', text: '回答' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, reason: 'rate_limited' })
    expect(runInterviewTurn).not.toHaveBeenCalled()
  })
  it.each([null, [], { action: 'request' }, { action: 'turn', text: '' }, { action: 'turn', text: 10 }])('rejects invalid body %j', async body => {
    expect(await (await POST(request(body))).json()).toMatchObject({ ok: false })
    expect(runInterviewTurn).not.toHaveBeenCalled()
  })
  it('rejects cross-origin requests', async () => {
    const req = request({ action: 'start' }); req.headers.set('origin', 'https://other.test')
    expect(await (await POST(req)).json()).toEqual({ ok: false, reason: 'invalid_origin' })
  })
  it('does not expose unexpected error messages or conversation text', async () => {
    vi.mocked(startOrResumeInterview).mockRejectedValue(new Error('private conversation'))
    const response = await POST(request({ action: 'start' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
