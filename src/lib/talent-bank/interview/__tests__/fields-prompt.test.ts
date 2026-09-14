import { describe, expect, it } from 'vitest'
import { INTERVIEW_FIELDS } from '../fields'
import { buildInterviewPrompt, STABLE_INTERVIEW_PROMPT } from '../prompt'
import { interviewProgress, summarizeInterview } from '../summary'
import { allowInterviewRequest } from '../rate-limit'

describe('interview fields and prompt', () => {
  it('defines exactly the requested twenty fields and eight required keys', () => {
    expect(INTERVIEW_FIELDS).toHaveLength(20)
    expect(new Set(INTERVIEW_FIELDS.map(f => f.field_key)).size).toBe(20)
    expect(INTERVIEW_FIELDS.filter(f => f.required).map(f => f.field_key)).toEqual([
      'display_name', 'activities', 'can_do', 'accepts_requests', 'paid_or_free', 'areas', 'available_times', 'passion',
    ])
    expect(INTERVIEW_FIELDS.filter(f => !f.required).map(f => f.field_key)).toEqual([
      'business_name', 'strengths', 'experience', 'qualifications', 'can_help', 'target_people', 'current_troubles',
      'looking_for', 'want_to_do_together', 'future_plans', 'want_to_connect', 'reason_started',
    ])
  })
  it('has no address, telephone, email or obsolete motivation field', () => {
    expect(INTERVIEW_FIELDS.some(f => /address|phone|email|motivation/.test(f.field_key))).toBe(false)
  })
  it('keeps the stable prefix before all variable states and prohibits contact details/child interviews', () => {
    const prompt = buildInterviewPrompt({ passion: { state: 'declined', value: null, evidence: [], updated_at: 'now' } })
    expect(prompt.startsWith(STABLE_INTERVIEW_PROMPT)).toBe(true)
    expect(buildInterviewPrompt({}).startsWith(STABLE_INTERVIEW_PROMPT)).toBe(true)
    expect(prompt).toContain('住所・電話番号・メールアドレスは聞かない')
    expect(prompt).toContain('子どもへの質問はしない')
    expect(prompt).toContain('"key":"passion","state":"declined"')
    expect(prompt).toContain('"key":"display_name","state":"unknown"')
    expect(prompt.indexOf('現在状態（参照データ）:')).toBeGreaterThan(prompt.indexOf('reason_started:'))
  })
  it('shows none/declined/unknown distinctly and rejects empty answered values', () => {
    const collected = {
      display_name: { state: 'answered' as const, value: '', evidence: [], updated_at: '' },
      passion: { state: 'declined' as const, value: null, evidence: [], updated_at: '' },
      qualifications: { state: 'none' as const, value: null, evidence: [], updated_at: '' },
    }
    expect(interviewProgress(collected)).toEqual({ required_done: 1, required_total: 8, optional_done: 1 })
    const summary = summarizeInterview(collected)
    expect(summary.find(f => f.key === 'activities')?.text).toBe('未回答')
    expect(summary.find(f => f.key === 'passion')?.text).toBe('答えたくない')
    expect(summary.find(f => f.key === 'qualifications')?.text).toBe('該当なし')
  })
  it('permits ten requests per member per minute and resets the window', () => {
    for (let i = 0; i < 10; i++) expect(allowInterviewRequest('rate-test-member', 100)).toBe(true)
    expect(allowInterviewRequest('rate-test-member', 101)).toBe(false)
    expect(allowInterviewRequest('another-member', 101)).toBe(true)
    expect(allowInterviewRequest('rate-test-member', 60_100)).toBe(true)
  })
})
