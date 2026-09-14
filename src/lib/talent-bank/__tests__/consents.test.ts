import { createHash } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'
import { mockDB } from './mock-db'
import { CONSENT_TEXTS, recordConsent, hasConsent, revokeConsent, getOrCreateSelfSubject } from '@/lib/consents'

const mocks = vi.hoisted(() => ({ client: vi.fn() }))
vi.mock('@/lib/talent-bank/db', () => ({ createTalentBankClient: mocks.client }))
let db: ReturnType<typeof mockDB>
beforeEach(() => {
  db = mockDB({
    members: [{ id: 'member-1', display_name: 'test' }],
    consents: [{ id: 'consent', member_id: 'member-1', subject_id: null, kind: 'interview', text_version: CONSENT_TEXTS.interview.version, revoked_at: null }],
  })
  mocks.client.mockResolvedValue(db)
})
test('records current text version and SHA-256 of the exact UTF-8 text', async () => {
  await recordConsent({ memberId: 'member-1', kind: 'photo' })
  expect(db.writes[0].value).toMatchObject({
    member_id: 'member-1', subject_id: null, kind: 'photo', text_version: CONSENT_TEXTS.photo.version,
    text_hash: createHash('sha256').update(CONSENT_TEXTS.photo.text, 'utf8').digest('hex'),
  })
  expect(JSON.stringify(db.writes)).not.toContain(CONSENT_TEXTS.photo.text)
  for (const kind of ['photo', 'video', 'external_ai'] as const) {
    expect(CONSENT_TEXTS[kind].text).toContain('イラスト化のため外部 AI サービスに写真を送ることがある')
  }
})
test('requires current version, active consent and matching subject scope', async () => {
  const query = { memberId: 'member-1', kind: 'interview' as const, version: CONSENT_TEXTS.interview.version }
  expect(await hasConsent(query)).toBe(true)
  expect(await hasConsent({ ...query, version: 'different' })).toBe(false)
  expect(await hasConsent({ ...query, subjectId: 'other' })).toBe(false)
  mocks.client.mockResolvedValue(mockDB({ consents: [{ member_id: 'member-1', subject_id: null, kind: 'interview', text_version: query.version, revoked_at: '2026-09-14' }] }))
  expect(await hasConsent(query)).toBe(false)
})
test('rejects another member even with supplied IDs', async () => {
  await expect(recordConsent({ memberId: 'other', kind: 'interview' })).rejects.toThrow('authentication')
  expect(db.writes).toHaveLength(0)
})
test('rejects non-owned subject', async () => {
  await expect(recordConsent({ memberId: 'member-1', subjectId: 'other', kind: 'interview' })).rejects.toThrow('subject')
  expect(db.writes).toHaveLength(0)
})
test('revocation writes only revoked_at', async () => {
  await revokeConsent({ memberId: 'member-1', consentId: 'consent' })
  expect(db.writes[0].operation).toBe('update')
  expect(Object.keys(db.writes[0].value)).toEqual(['revoked_at'])
})
test('creates a self subject without asserting adult confirmation and reuses existing subjects', async () => {
  await getOrCreateSelfSubject('member-1')
  expect(db.writes[0].value).toMatchObject({ owner_member_id: 'member-1', subject_type: 'person', is_adult_confirmed: false })
  mocks.client.mockResolvedValue(mockDB({ talent_subjects: [{ id: 'self', owner_member_id: 'member-1', subject_type: 'person' }] }))
  expect((await getOrCreateSelfSubject('member-1')).id).toBe('self')
})
