import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fields, memberId, profileDB, tag, version } from './mock-db'
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), consent: vi.fn(), ai: vi.fn(), notify: vi.fn() }))
vi.mock('../../db', () => ({ createTalentBankClient: mocks.client, createTalentBankServiceClient: mocks.service }))
vi.mock('@/lib/consents', () => ({ hasConsent: mocks.consent, CONSENT_TEXTS: { profile: { version: 'v1' }, external_ai: { version: 'v1' } } }))
vi.mock('@/lib/ai/call', () => ({ callAI: mocks.ai }))
vi.mock('@/lib/notify', () => ({ insertNotification: mocks.notify }))
import { generateProfileDraft } from '../generate'
import { createRevision, ownerApprove, updateDraft } from '../review'
import { adminApprove, adminReject, unpublish } from '../publish'
import { getPublicProfile, searchConditions, searchPublicProfiles, withoutPublishedLegacy } from '../read'
import { applyFieldPatch, groundedFields, profileSchema } from '../validation'

let db: ReturnType<typeof profileDB>
beforeEach(() => {
  db = profileDB(); mocks.client.mockResolvedValue(db); mocks.service.mockReturnValue(db)
  mocks.consent.mockResolvedValue(true); mocks.notify.mockResolvedValue(undefined)
  mocks.ai.mockReset().mockImplementation(async ({ purpose }: { purpose: string }) => purpose === 'extract_profile' ? {
    runId: 'run-generated', structured: { summary_short: '地域のものづくり', summary_long: '地域で活動しています。',
      fields: Object.fromEntries(Object.entries(fields()).map(([k, v]) => [k, v.value])) },
  } : { runId: 'tag-run', structured: { slugs: ['leathercraft'], suggested_tags: [] } })
})
const generate = () => generateProfileDraft({ memberId, interviewId: 'interview-1' })
const approve = () => ownerApprove({ memberId, versionId: 'version-1' })
describe('generation', () => {
  it.each(['none', 'declined', 'unknown'] as const)('discards invented %s values and preserves evidence', async state => {
    const collected = fields(); collected.strengths.state = state; collected.strengths.value = null
    db.tables.interviews[0].collected_json = collected
    const result = await generate()
    const saved = db.tables.talent_profile_versions.find(v => v.id === result.versionId)!
    expect(saved.fields_json).toMatchObject({ strengths: { state, value: null }, can_do: { evidence: collected.can_do.evidence, source: 'interview' } })
  })
  it('stores only existing tags and keeps unknown suggestions without creating dictionary rows', async () => {
    mocks.ai.mockResolvedValueOnce({ runId: 'run', structured: { summary_short: '', summary_long: '', fields: {} } })
      .mockResolvedValueOnce({ structured: { slugs: ['leathercraft', 'new-tag'], suggested_tags: ['新しいタグ'] } })
    expect((await generate()).suggested_tags).toEqual(['新しいタグ', 'new-tag'])
    expect(db.tables.talent_tags).toEqual([tag])
    expect(db.tables.talent_profile_version_tags).toEqual([{ version_id: 'version-2', tag_id: tag.id, source: 'ai' }])
  })
  it('rejects missing consent before calling AI', async () => {
    mocks.consent.mockResolvedValue(false)
    await expect(generate()).rejects.toThrow('consent_required'); expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('rechecks external AI consent', async () => {
    mocks.consent.mockImplementation(async ({ kind }: { kind: string }) => kind !== 'external_ai')
    await expect(generate()).rejects.toThrow('consent_required'); expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('rejects unfinished interview', async () => {
    db.tables.interviews[0].status = 'active'
    await expect(generate()).rejects.toThrow('interview_not_done'); expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('does not accept another member interview', async () => {
    db.tables.interviews[0].member_id = 'other'
    await expect(generate()).rejects.toThrow('interview_unavailable')
  })
  it('creates a new version on every generation', async () => {
    expect((await generate()).versionId).toBe('version-2'); expect((await generate()).versionId).toBe('version-3')
    expect(db.tables.talent_profile_versions.map(v => v.version)).toEqual([1, 2, 3])
    expect(db.tables.talent_profiles[0].draft_version_id).toBe('version-3')
  })
  it('passes the restricted schema and enum through Phase 1 callAI', async () => {
    await generate()
    expect(mocks.ai.mock.calls[0][0]).toMatchObject({ operation: 'extractStructured', purpose: 'extract_profile', caseId: 'interview-1', schema: profileSchema })
    expect(mocks.ai.mock.calls[1][0].schema.properties.slugs.items.enum).toEqual([tag.slug])
    expect(Object.keys(profileSchema.properties.fields.properties)).toHaveLength(20)
  })
  it('never writes a partial version when AI fails', async () => {
    mocks.ai.mockRejectedValue(new Error('private service details'))
    await expect(generate()).rejects.toThrow(); expect(db.tables.talent_profile_versions).toHaveLength(1)
  })
  it('clips an oversized summary instead of failing (schema cannot enforce maxLength)', async () => {
    mocks.ai.mockResolvedValueOnce({ structured: { summary_short: '長'.repeat(81), summary_long: '', fields: {} } })
    await generate()
    const saved = db.tables.talent_profile_versions.at(-1) as { summary_short: string }
    expect([...saved.summary_short]).toHaveLength(80)
  })
  it('reports transaction failure', async () => {
    db.fail(); await expect(generate()).rejects.toThrow('storage_unavailable')
  })
})
describe('owner review', () => {
  it('rejects unknown required fields', async () => {
    const f = fields(); f.activities.state = 'unknown'; f.activities.value = null
    db.tables.talent_profile_versions[0].fields_json = f
    await expect(approve()).rejects.toThrow('required_fields_missing')
  })
  it.each(['declined', 'none'] as const)('accepts %s for required fields', async state => {
    const f = fields(); f.activities.state = state; f.activities.value = null
    db.tables.talent_profile_versions[0].fields_json = f
    await approve(); expect(db.tables.talent_profile_versions[0].status).toBe('owner_reviewed')
  })
  it('marks changed fields owner and retains original evidence', async () => {
    await updateDraft({ memberId, versionId: 'version-1', patch: { fields: { activities: { value: '自分で修正' } } } })
    expect(db.tables.talent_profile_versions[0]).toMatchObject({ edited_by_owner_at: 'later', fields_json: {
      activities: { value: '自分で修正', source: 'owner', evidence: fields().activities.evidence }, strengths: { source: 'interview' },
    } })
  })
  it.each(['approved', 'published', 'retired'] as const)('prevents editing %s', async status => {
    db.tables.talent_profile_versions[0].status = status
    await expect(updateDraft({ memberId, versionId: 'version-1', patch: { summary_short: '変更' } })).rejects.toThrow('immutable_version')
  })
  it('invalidates owner approval after editing', async () => {
    await approve()
    await updateDraft({ memberId, versionId: 'version-1', patch: { public_scope: 'public' } })
    expect(db.tables.talent_profile_versions[0]).toMatchObject({ status: 'draft', owner_approved_at: null })
  })
  it('keeps published scope unchanged while editing the draft', async () => {
    db.tables.talent_profiles[0].current_version_id = 'old'; db.tables.talent_profiles[0].public_scope = 'registered_only'
    await updateDraft({ memberId, versionId: 'version-1', patch: { public_scope: 'public' } })
    expect(db.tables.talent_profiles[0].public_scope).toBe('registered_only')
  })
  it('rejects another owner and stale drafts', async () => {
    db.tables.talent_profiles[0].member_id = 'other'
    await expect(approve()).rejects.toThrow('unauthorized')
    db.tables.talent_profiles[0].member_id = memberId; db.tables.talent_profiles[0].draft_version_id = 'new'
    await expect(approve()).rejects.toThrow('stale_version')
  })
  it('copies a published version before editing', async () => {
    db.tables.talent_profiles[0].draft_version_id = null; db.tables.talent_profile_versions[0].status = 'published'
    expect(await createRevision({ memberId, versionId: 'version-1' })).toBe('version-2')
    expect(db.tables.talent_profile_versions[0].status).toBe('published')
  })
  it('does not accept arbitrary fields or evidence from an owner patch', () => {
    expect(() => applyFieldPatch(fields(), { email: { value: 'x' } })).toThrow('invalid_field')
    expect(() => applyFieldPatch(fields(), { activities: { evidence: ['forged'] } })).toThrow('invalid_field')
  })
})
describe('publication contract', () => {
  const publish = () => adminApprove({ adminId: memberId, versionId: 'version-1', minutes: 5, editCount: 1 })
  it('retires old version, changes current and records publication plus work time', async () => {
    db.tables.talent_profile_versions.push(version({ id: 'old', status: 'published', version: 0 }))
    db.tables.talent_profiles[0].current_version_id = 'old'
    await approve(); await publish()
    expect(db.tables.talent_profile_versions.find(v => v.id === 'old')?.status).toBe('retired')
    expect(db.tables.talent_profiles[0]).toMatchObject({ current_version_id: 'version-1', draft_version_id: null })
    expect(db.tables.publications).toHaveLength(1)
    expect(db.tables.work_logs).toEqual([{ kind: 'profile_review', minutes: 5, edit_count: 1 }])
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: memberId, kind: 'member' }))
  })
  it('rejects non-admin before creating service client', async () => {
    db.denyAdmin(); await expect(publish()).rejects.toThrow('admin_required'); expect(mocks.service).not.toHaveBeenCalled()
  })
  it('requires owner approval', async () => { await expect(publish()).rejects.toThrow('publish_conflict') })
  it('validates minutes', async () => {
    await expect(adminApprove({ adminId: memberId, versionId: 'version-1', minutes: NaN, editCount: 0 })).rejects.toThrow('invalid_work_log')
  })
  it('returns rejection to draft with reason', async () => {
    await approve(); await adminReject({ adminId: memberId, versionId: 'version-1', reason: '内容を確認してください' })
    expect(db.tables.talent_profile_versions[0]).toMatchObject({ status: 'draft', owner_approved_at: null, rejected_reason: '内容を確認してください' })
  })
  it('rejects empty rejection reason', async () => {
    await expect(adminReject({ adminId: memberId, versionId: 'version-1', reason: ' ' })).rejects.toThrow('reason_required')
  })
  it('owner can unpublish, clearing current and closing publication', async () => {
    await approve(); await publish(); await unpublish({ memberId, profileId: 'profile-1', reason: '停止' })
    expect(db.tables.talent_profiles[0].current_version_id).toBeNull()
    expect(db.tables.publications[0].unpublished_at).toBe('later')
    expect(db.tables.talent_profile_versions[0].status).toBe('retired')
  })
  it('failed publication sends no success notification', async () => {
    await approve(); db.fail(); await expect(publish()).rejects.toThrow('publish_conflict'); expect(mocks.notify).not.toHaveBeenCalled()
  })
})
describe('read and search', () => {
  it('returns null without published version, allowing legacy fallback', async () => { expect(await getPublicProfile({ memberId })).toBeNull() })
  it('uses only the current published version and its tags', async () => {
    db.tables.talent_profiles[0].current_version_id = 'version-1'; db.tables.talent_profile_versions[0].status = 'published'
    db.tables.talent_profile_version_tags.push({ version_id: 'version-1', tag_id: tag.id, source: 'ai' })
    const read = await getPublicProfile({ subjectId: 'subject-1' })
    expect(read?.version.id).toBe('version-1'); expect(read?.tags).toEqual([tag])
  })
  it('never treats a draft pointer as published', async () => {
    db.tables.talent_profiles[0].current_version_id = 'version-1'
    expect(await getPublicProfile({ memberId })).toBeNull()
  })
  it('normalizes and safely binds q/tag/area as RPC parameters', async () => {
    expect(searchConditions({ q: ' Ａ%_\\ ', tag: 'leathercraft', area: '印西市' })).toEqual({ p_q: '%A\\%\\_\\\\%', p_tag: 'leathercraft', p_area: '%印西市%' })
    await searchPublicProfiles({ q: '革細工', tag: 'leathercraft', area: '印西市' })
    expect(db.rpc).toHaveBeenCalledWith('search_talent_profiles', { p_q: '%革細工%', p_tag: 'leathercraft', p_area: '%印西市%' })
  })
  it('omits empty conditions', () => { expect(searchConditions({})).toEqual({ p_q: '', p_tag: '', p_area: '' }) })
  it('deduplicates legacy cards before keyword filtering', () => {
    expect(withoutPublishedLegacy([{ member_id: 'a' }, { member_id: 'b' }], [{ member_id: 'a' }])).toEqual([{ member_id: 'b' }])
  })
  it('cannot elevate a viewer identity', async () => {
    await expect(getPublicProfile({ memberId }, { memberId: 'other' })).rejects.toThrow('unauthorized')
  })
  it('blank answered values become unknown and extra AI keys are dropped', () => {
    const f = fields(); f.activities.value = ' '
    const cleaned = groundedFields(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { ...v, updated_at: '' }])), { activities: '推測', email: '秘密' })
    expect(cleaned.activities).toMatchObject({ state: 'unknown', value: null }); expect(cleaned).not.toHaveProperty('email')
  })
})
