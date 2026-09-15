import { beforeEach, expect, it, vi } from 'vitest'
import { fields, profileDB } from './mock-db'
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), notify: vi.fn() }))
vi.mock('../../db', () => ({ createTalentBankClient: mocks.client, createTalentBankServiceClient: mocks.service }))
vi.mock('@/lib/notify', () => ({ insertNotification: mocks.notify }))
import { notifyAdminsOfApplication } from '../publish'

let db: ReturnType<typeof profileDB>
beforeEach(() => {
  db = profileDB(); mocks.client.mockResolvedValue(db); mocks.service.mockReset().mockReturnValue(db)
  mocks.notify.mockReset().mockResolvedValue(undefined)
})

it('notifies every active admin with a link to the review page', async () => {
  const f = fields(); f.display_name.value = '中司'
  db.tables.talent_profile_versions[0].fields_json = f
  db.tables.members = [
    { id: 'admin-1', admin_role: 'super', deleted_at: null },
    { id: 'admin-2', admin_role: 'committee', deleted_at: null },
    { id: 'admin-gone', admin_role: 'committee', deleted_at: '2026-01-01' },
    { id: 'member-2', admin_role: null, deleted_at: null },
  ]
  await notifyAdminsOfApplication('version-1')
  expect(mocks.notify).toHaveBeenCalledTimes(2)
  expect(mocks.notify.mock.calls.map(c => c[0].recipientId).sort()).toEqual(['admin-1', 'admin-2'])
  expect(mocks.notify.mock.calls[0][0]).toMatchObject({
    kind: 'member', linkUrl: '/admin/talent-bank', title: '中司さんが人材バンクのプロフィール公開を申請しました',
  })
})

it('never throws and sends nothing when the admin lookup fails', async () => {
  mocks.service.mockImplementation(() => { throw new Error('down') })
  await expect(notifyAdminsOfApplication('version-1')).resolves.toBeUndefined()
  expect(mocks.notify).not.toHaveBeenCalled()
})
