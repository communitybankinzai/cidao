import { beforeEach, expect, it, vi } from 'vitest'
import { fields, memberId, profile, profileDB, version } from '../profile/__tests__/mock-db'
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), notify: vi.fn(), callAI: vi.fn() }))
vi.mock('../db', () => ({ createTalentBankClient: mocks.client, createTalentBankServiceClient: mocks.service }))
vi.mock('@/lib/notify', () => ({ insertNotification: mocks.notify }))
vi.mock('@/lib/ai/call', () => ({ callAI: mocks.callAI }))
import { adminDraftIntro, ownerRespondIntro } from '../cbi-intro'

let db: ReturnType<typeof profileDB>
beforeEach(() => {
  db = profileDB()
  db.tables.talent_profiles = [{ ...profile(), current_version_id: 'version-1' }]
  db.tables.talent_profile_versions = [version({ status: 'published' })]
  db.tables.members = [{ id: memberId, display_name: '表示名', deleted_at: null }]
  db.tables.member_cbi_intros = []
  const upsert = vi.fn(async (row: Record<string, unknown>) => { db.tables.member_cbi_intros = [{ ...row, updated_at: 'now' }]; return { error: null } })
  const base = db.from
  db.from = vi.fn((table: string) => Object.assign(base(table), { upsert })) as typeof db.from
  mocks.client.mockResolvedValue(db); mocks.service.mockReturnValue(db)
  mocks.notify.mockReset().mockResolvedValue(undefined)
  mocks.callAI.mockReset().mockResolvedValue({ runId: 'run-1', structured: { body: '表示名さんは、革小物づくりと講師で地域を支える人です。' } })
})

it('drafts from the published version facts only and keeps it hidden from the owner (draft)', async () => {
  const body = await adminDraftIntro({ adminId: memberId, memberId })
  expect(body).toContain('表示名さん')
  const call = mocks.callAI.mock.calls[0][0]
  expect(call.purpose).toBe('cbi_intro')
  const prompt = JSON.parse(call.prompt)
  expect(prompt.facts.display_name).toBe('氏名または表示名の回答')
  expect(Object.keys(prompt.facts)).toHaveLength(Object.keys(fields()).length)
  expect(db.tables.member_cbi_intros[0]).toMatchObject({ status: 'draft', draft_source: 'ai', written_by: memberId })
})

it('refuses to draft when the profile is not published', async () => {
  db.tables.talent_profiles = [{ ...profile(), current_version_id: null }]
  await expect(adminDraftIntro({ adminId: memberId, memberId })).rejects.toMatchObject({ reason: 'profile_not_published' })
  expect(mocks.callAI).not.toHaveBeenCalled()
})

it('owner can only respond while the intro awaits review', async () => {
  db.tables.member_cbi_intros = [{ member_id: memberId, status: 'draft', written_by: 'admin-1' }]
  await expect(ownerRespondIntro({ memberId, approve: true })).rejects.toMatchObject({ reason: 'stale_version' })
  db.tables.member_cbi_intros = [{ member_id: memberId, status: 'owner_review', written_by: 'admin-1' }]
  await expect(ownerRespondIntro({ memberId, approve: false, comment: '' })).rejects.toMatchObject({ reason: 'reason_required' })
})
