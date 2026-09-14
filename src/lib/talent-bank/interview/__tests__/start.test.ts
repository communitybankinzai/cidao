import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTalentBankClient } from '../../db'
import { getOrCreateSelfSubject, hasConsent } from '@/lib/consents'
import { startOrResumeInterview } from '../start'
import { pauseInterview } from '../pause'
import { INITIAL_MESSAGE } from '../config'
import { interviewDB, interviewRow, memberId, subject } from './mock-interview-db'

vi.mock('../../db', () => ({ createTalentBankClient: vi.fn() }))
vi.mock('@/lib/consents', () => ({ getOrCreateSelfSubject: vi.fn(), hasConsent: vi.fn(),
  CONSENT_TEXTS: { interview: { version: 'current-interview' }, external_ai: { version: 'current-ai' } },
}))
let db: ReturnType<typeof interviewDB>
beforeEach(() => {
  db = interviewDB([])
  vi.mocked(createTalentBankClient).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof createTalentBankClient>>)
  vi.mocked(getOrCreateSelfSubject).mockResolvedValue(subject)
  vi.mocked(hasConsent).mockResolvedValue(true)
})
describe('start and pause', () => {
  it.each(['interview', 'external_ai'])('refuses without current %s consent', async missing => {
    vi.mocked(hasConsent).mockImplementation(async input => input.kind !== missing)
    await expect(startOrResumeInterview({ memberId })).rejects.toMatchObject({ reason: 'consent_required' })
    expect(db.tables.interviews).toHaveLength(0)
    expect(hasConsent).toHaveBeenCalledWith({ memberId, subjectId: subject.id, kind: 'interview', version: 'current-interview' })
    expect(hasConsent).toHaveBeenCalledWith({ memberId, subjectId: subject.id, kind: 'external_ai', version: 'current-ai' })
  })
  it('requires adult confirmation', async () => {
    db.tables.talent_subjects[0].is_adult_confirmed = false
    await expect(startOrResumeInterview({ memberId })).rejects.toMatchObject({ reason: 'eligibility_required' })
    expect(db.tables.interviews).toHaveLength(0)
  })
  it('starts with a fixed greeting and does not duplicate active interviews or greetings', async () => {
    const first = await startOrResumeInterview({ memberId })
    const second = await startOrResumeInterview({ memberId })
    expect(first.interviewId).toBe(second.interviewId)
    expect(db.tables.interviews).toHaveLength(1)
    expect(db.messages()).toHaveLength(1)
    expect(first.messages[0]).toMatchObject({ content: INITIAL_MESSAGE, run_id: null })
    expect(getOrCreateSelfSubject).toHaveBeenCalledWith(memberId)
  })
  it('resumes paused interviews with their saved progress', async () => {
    db.tables.interviews.push(interviewRow({ status: 'paused', turn_count: 2, collected_json: {
      passion: { state: 'declined', value: null, evidence: ['message'], updated_at: 'old' },
    } }))
    expect(await startOrResumeInterview({ memberId })).toMatchObject({ status: 'active', turn_count: 2, progress: { required_done: 1 } })
    expect(db.tables.interviews).toHaveLength(1)
  })
  it('recovers a simultaneous insert through the unique active index', async () => {
    db.raceInsert(interviewRow({ id: 'concurrent' }))
    expect(await startOrResumeInterview({ memberId })).toMatchObject({ interviewId: 'concurrent' })
    expect(db.tables.interviews).toHaveLength(1)
  })
  it('returns an existing completed interview instead of spending a fresh budget', async () => {
    db.tables.interviews.push(interviewRow({ status: 'done', turn_count: 8 }))
    expect(await startOrResumeInterview({ memberId })).toMatchObject({ status: 'done' })
    expect(db.tables.interviews).toHaveLength(1)
  })
  it('uses an owned shop subject and keeps self person unchanged', async () => {
    db.tables.talent_subjects.push({ ...subject, id: 'shop', subject_type: 'shop', updated_at: '2099-01-01' })
    await startOrResumeInterview({ memberId })
    expect(db.interview().subject_id).toBe('shop')
    expect(db.tables.talent_subjects[0].subject_type).toBe('person')
    expect(hasConsent).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'shop' }))
  })
  it('pauses the owner interview and resumes without creating a replacement', async () => {
    db.tables.interviews.push(interviewRow())
    expect(await pauseInterview({ interviewId: 'interview-1', memberId })).toEqual({ status: 'paused' })
    expect(db.interview().status).toBe('paused')
    expect(await startOrResumeInterview({ memberId })).toMatchObject({ status: 'active' })
    expect(db.tables.interviews).toHaveLength(1)
  })
  it('does not pause a turn while its AI call is in flight', async () => {
    db.tables.interviews.push(interviewRow({ sufficiency_json: { in_flight: 'token', lease_until: new Date(Date.now() + 60_000).toISOString() } }))
    await expect(pauseInterview({ interviewId: 'interview-1', memberId })).rejects.toMatchObject({ reason: 'busy' })
  })
  it('does not recreate original messages older than retention', async () => {
    db.tables.interviews.push(interviewRow({ created_at: '2020-01-01' }))
    await startOrResumeInterview({ memberId })
    expect(db.messages()).toHaveLength(0)
  })
})
