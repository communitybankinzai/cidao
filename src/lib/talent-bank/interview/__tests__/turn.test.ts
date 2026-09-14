import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTalentBankClient } from '../../db'
import { getOrCreateSelfSubject, hasConsent } from '@/lib/consents'
import { callAI } from '@/lib/ai/call'
import { INTERVIEW_FIELDS } from '../fields'
import { MAX_INTERVIEW_TURNS } from '../config'
import { runInterviewTurn, TURN_SCHEMA } from '../turn'
import { interviewDB, memberId, subject } from './mock-interview-db'

vi.mock('../../db', () => ({ createTalentBankClient: vi.fn() }))
vi.mock('@/lib/consents', () => ({
  getOrCreateSelfSubject: vi.fn(), hasConsent: vi.fn(),
  CONSENT_TEXTS: { interview: { version: 'current' }, external_ai: { version: 'current' } },
}))
vi.mock('@/lib/ai/call', () => ({ callAI: vi.fn() }))
let db: ReturnType<typeof interviewDB>
const input = { interviewId: 'interview-1', memberId, userText: '地域の活動をしています' }
const output = (updates: unknown[] = [], sufficient = false) => ({
  model: 'mock', text: '', runId: 'run-1', usage: null,
  structured: { assistant_message: 'できることを教えてください。', field_updates: updates, is_sufficient: sufficient, missing_required: [] },
})
beforeEach(() => {
  db = interviewDB()
  vi.mocked(createTalentBankClient).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof createTalentBankClient>>)
  vi.mocked(getOrCreateSelfSubject).mockResolvedValue(subject)
  vi.mocked(hasConsent).mockResolvedValue(true)
  vi.mocked(callAI).mockResolvedValue(output())
})
describe('runInterviewTurn', () => {
  it('merges updates, preserves other fields and appends the actual message evidence and run_id', async () => {
    db.interview().collected_json = {
      activities: { state: 'answered', value: '古い内容', evidence: ['old-message'], updated_at: 'old' },
      passion: { state: 'declined', value: null, evidence: ['older'], updated_at: 'old' },
    }
    vi.mocked(callAI).mockResolvedValue(output([{ key: 'activities', state: 'answered', value: '地域活動' }]))
    const result = await runInterviewTurn(input)
    expect(result).toMatchObject({ status: 'active', progress: { required_done: 2, required_total: 8 } })
    const messages = db.messages()
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(db.interview().collected_json.activities).toMatchObject({ value: '地域活動', evidence: ['old-message', messages[0].id] })
    expect(db.interview().collected_json.activities.updated_at).not.toBe('old')
    expect(db.interview().collected_json.passion.state).toBe('declined')
    expect(messages[1].run_id).toBe('run-1')
    expect(db.interview().turn_count).toBe(1)
    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({ operation: 'extractStructured', purpose: 'interview',
      caseId: input.interviewId, subjectId: subject.id, memberId, schema: TURN_SCHEMA }))
    const prompt = JSON.parse(vi.mocked(callAI).mock.calls[0][0].operation === 'extractStructured' ?
      (vi.mocked(callAI).mock.calls[0][0] as { prompt: string }).prompt : '{}')
    expect(prompt.current_user_message.id).toBe(messages[0].id)
    expect(prompt.history).toEqual([])
  })
  it('does not complete when AI says sufficient but required fields are missing', async () => {
    vi.mocked(callAI).mockResolvedValue(output([], true))
    expect(await runInterviewTurn(input)).toMatchObject({ status: 'active' })
    expect(db.interview().completed_at).toBeNull()
    expect(db.messages()[1].content).toContain('氏名または表示名')
  })
  it('completes only when both checks pass, accepting none and declined', async () => {
    vi.mocked(callAI).mockResolvedValue(output(INTERVIEW_FIELDS.filter(f => f.required).map((f, i) => ({
      key: f.field_key, state: i % 2 ? 'none' : 'declined', value: null,
    })), true))
    expect(await runInterviewTurn(input)).toMatchObject({ status: 'done', progress: { required_done: 8 } })
    expect(db.interview().status).toBe('done')
    expect(db.interview().completed_at).not.toBeNull()
  })
  it('stays active if server requirements are satisfied but AI says false', async () => {
    vi.mocked(callAI).mockResolvedValue(output(INTERVIEW_FIELDS.filter(f => f.required).map(f => ({ key: f.field_key, state: 'answered', value: '回答' }))))
    expect(await runInterviewTurn(input)).toMatchObject({ status: 'active', progress: { required_done: 8 } })
  })
  it.each([MAX_INTERVIEW_TURNS, MAX_INTERVIEW_TURNS + 1])('refuses at turn_count %i before writes or AI', async count => {
    db.interview().turn_count = count
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'turn_limit' })
    expect(callAI).not.toHaveBeenCalled(); expect(db.messages()).toHaveLength(0)
  })
  it('permits the fortieth attempt', async () => {
    db.interview().turn_count = MAX_INTERVIEW_TURNS - 1
    await runInterviewTurn(input)
    expect(db.interview().turn_count).toBe(40)
    expect(db.messages().map(m => m.seq)).toEqual([79, 80])
  })
  it('keeps user text and consumes a budget slot on AI failure without logging text', async () => {
    const log = vi.spyOn(console, 'error')
    vi.mocked(callAI).mockRejectedValue(new Error('sensitive body'))
    expect(await runInterviewTurn(input)).toEqual({ error: 'ai_unavailable' })
    expect(db.messages()).toMatchObject([{ role: 'user', content: input.userText }])
    expect(db.interview().turn_count).toBe(1)
    expect(db.interview().sufficiency_json).toEqual({ error: 'ai_unavailable' })
    expect(log).not.toHaveBeenCalled()
  })
  it('ignores undefined keys including prototype names', async () => {
    vi.mocked(callAI).mockResolvedValue(output(['email', '__proto__', 'motivation'].map(key => ({ key, state: 'answered', value: 'ignored' }))))
    await runInterviewTurn(input)
    expect(db.interview().collected_json).toEqual({})
  })
  it('rejects malformed AI output while keeping the user message', async () => {
    vi.mocked(callAI).mockResolvedValue({ ...output(), structured: { assistant_message: 42 } })
    expect(await runInterviewTurn(input)).toEqual({ error: 'ai_unavailable' })
    expect(db.messages()).toHaveLength(1)
  })
  it('does not count an empty answered field as completed', async () => {
    vi.mocked(callAI).mockResolvedValue(output([{ key: 'display_name', state: 'answered', value: ' ' }], true))
    expect(await runInterviewTurn(input)).toMatchObject({ status: 'active', progress: { required_done: 0 } })
  })
  it.each(['paused', 'done', 'abandoned'] as const)('refuses %s interviews', async status => {
    db.interview().status = status
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'not_active' })
    expect(callAI).not.toHaveBeenCalled()
  })
  it('rejects another member even if an admin could read the row', async () => {
    db.interview().member_id = 'someone-else'
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'interview_not_found' })
    expect(callAI).not.toHaveBeenCalled()
  })
  it('rechecks current consent and adult eligibility on every turn', async () => {
    vi.mocked(hasConsent).mockResolvedValue(false)
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'consent_required' })
    vi.mocked(hasConsent).mockResolvedValue(true)
    db.tables.talent_subjects[0].is_adult_confirmed = false
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'eligibility_required' })
    expect(callAI).not.toHaveBeenCalled(); expect(db.messages()).toHaveLength(0)
  })
  it('rejects an in-flight turn and a lost atomic claim without AI calls', async () => {
    db.interview().sufficiency_json = { in_flight: 'token', lease_until: new Date(Date.now() + 60_000).toISOString() }
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'busy' })
    db.interview().sufficiency_json = null
    db.rpc.mockResolvedValueOnce({ data: false, error: null })
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'busy' })
    expect(callAI).not.toHaveBeenCalled()
  })
  it('does not report completion or partially save assistant data on finalize failure', async () => {
    db.failFinish()
    await expect(runInterviewTurn(input)).rejects.toMatchObject({ reason: 'storage_unavailable' })
    expect(db.messages()).toHaveLength(1)
    expect(db.interview().status).toBe('active')
  })
  it('refuses empty and oversized input before writing', async () => {
    for (const userText of ['', ' ', 'x'.repeat(4001)]) await expect(runInterviewTurn({ ...input, userText })).rejects.toMatchObject({ reason: 'invalid_text' })
    expect(db.messages()).toHaveLength(0); expect(callAI).not.toHaveBeenCalled()
  })
  it('passes historical messages and this answer exactly once', async () => {
    db.tables.interview_messages.push({ id: 'hello', interview_id: input.interviewId, seq: 0, role: 'assistant', content: '名前は？' })
    await runInterviewTurn(input)
    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('名前は？') }))
    expect(db.messages().filter(m => m.role === 'user')).toHaveLength(1)
  })
})
