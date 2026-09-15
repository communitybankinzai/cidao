import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fields, memberId, profileDB } from './mock-db'
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), consent: vi.fn(), ai: vi.fn() }))
vi.mock('../../db', () => ({ createTalentBankClient: mocks.client, createTalentBankServiceClient: mocks.service }))
vi.mock('@/lib/consents', () => ({ hasConsent: mocks.consent, CONSENT_TEXTS: { profile: { version: 'v1' }, external_ai: { version: 'v1' } } }))
vi.mock('@/lib/ai/call', () => ({ callAI: mocks.ai }))
import { EDIT_SCHEMA, editProfileByChat, stripContacts } from '../edit-chat'
import { applyFieldPatch } from '../validation'

let db: ReturnType<typeof profileDB>
beforeEach(() => {
  db = profileDB(); mocks.client.mockResolvedValue(db); mocks.service.mockReturnValue(db)
  mocks.consent.mockResolvedValue(true); mocks.ai.mockReset()
})
const reply = (structured: Record<string, unknown>) => mocks.ai.mockResolvedValueOnce({ runId: 'edit-run', structured: {
  reply: '', summary_short: '', summary_long: '', updates: [], ...structured,
} })
const edit = (message = '得意なことに縫製が早いことを足して') => editProfileByChat({ memberId, versionId: 'version-1', message })
const saved = () => db.tables.talent_profile_versions[0] as { fields_json: ReturnType<typeof fields>; summary_short: string; edited_by_owner_at: unknown }

describe('editProfileByChat', () => {
  it('applies what the owner said and marks it as owner-edited', async () => {
    reply({ reply: '得意なことを足しました。', updates: [{ key: 'strengths', state: 'answered', value: '革の縫製が早い' }] })
    await expect(edit()).resolves.toEqual({ reply: '得意なことを足しました。', changed: true })
    expect(saved().fields_json.strengths).toMatchObject({ state: 'answered', value: '革の縫製が早い', source: 'owner' })
    expect(saved().summary_short).toBe('短い紹介')
    expect(mocks.ai.mock.calls[0][0]).toMatchObject({ purpose: 'edit_profile', operation: 'extractStructured', schema: EDIT_SCHEMA })
  })
  it('removes phone numbers and e-mail addresses even if the AI writes them', async () => {
    reply({ updates: [{ key: 'accepts_requests', state: 'answered', value: '連絡は090-1234-5678かa@b.jpまで' }] })
    await edit('連絡先を載せて')
    const value = saved().fields_json.accepts_requests.value ?? ''
    expect(value).not.toMatch(/090|a@b\.jp/)
    expect(value).toContain('連絡先は掲載しません')
  })
  it('turns "do not show" into declined with no value', async () => {
    reply({ updates: [{ key: 'paid_or_free', state: 'declined', value: '無償です' }] })
    await edit('料金のことは載せないで')
    expect(saved().fields_json.paid_or_free).toMatchObject({ state: 'declined', value: null })
  })
  it('changes nothing when the AI only asks a question', async () => {
    reply({ reply: 'どの項目を直しますか？' })
    await expect(edit('直して')).resolves.toEqual({ reply: 'どの項目を直しますか？', changed: false })
    expect(saved().edited_by_owner_at).toBeNull()
  })
  it('ignores keys outside the 20 profile fields', async () => {
    reply({ updates: [{ key: 'address', state: 'answered', value: '印西市〇〇1-2-3' }] })
    await expect(edit()).resolves.toMatchObject({ changed: false })
  })
  it('refuses to edit a published version', async () => {
    db.tables.talent_profile_versions[0].status = 'published'
    await expect(edit()).rejects.toThrow('immutable_version')
    expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('refuses empty or overlong requests without calling the AI', async () => {
    await expect(edit('   ')).rejects.toThrow('invalid_text')
    await expect(edit('あ'.repeat(1001))).rejects.toThrow('invalid_text')
    expect(mocks.ai).not.toHaveBeenCalled()
  })
})

describe('schema and helpers', () => {
  it('uses no constructs the structured-output API rejects', () => {
    const text = JSON.stringify(EDIT_SCHEMA)
    expect(text).not.toMatch(/anyOf|maxLength|maxItems|"type":\[/)
  })
  it('strips contacts', () => {
    expect(stripContacts('電話 0476-12-3456 / mail x.y@example.com')).not.toMatch(/0476|example/)
  })
  it('keeps text written into a field that was still marked unanswered', () => {
    const f = fields(); f.experience = { state: 'unknown', value: null, evidence: [], source: 'interview' }
    expect(applyFieldPatch(f, { experience: { state: 'unknown', value: '革小物づくり10年' } }).experience)
      .toMatchObject({ state: 'answered', value: '革小物づくり10年', source: 'owner' })
  })
  it('turns an emptied answer back into unanswered instead of failing', () => {
    expect(applyFieldPatch(fields(), { strengths: { state: 'answered', value: '  ' } }).strengths).toMatchObject({ state: 'unknown', value: null })
  })
})
