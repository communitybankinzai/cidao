import 'server-only'
import { insertNotification } from '@/lib/notify'
import { createTalentBankServiceClient } from '../db'
import { memberClient } from '../interview/access'
import { adminClient } from './access'
import { ProfileError, shortText } from './validation'

async function notify(recipientId: string, title: string) {
  await insertNotification({ recipientId, kind: 'member', title, linkUrl: '/me/talent' })
}
export async function adminApprove({ adminId, versionId, minutes, editCount, note }: { adminId: string; versionId: string; minutes: number; editCount: number; note?: string }) {
  await adminClient(adminId)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || !Number.isInteger(editCount) || editCount < 0) throw new ProfileError('invalid_work_log')
  const result = await createTalentBankServiceClient().rpc('publish_talent_version', {
    p_actor: adminId, p_version: versionId, p_minutes: minutes, p_edits: editCount, p_note: note ? shortText(note, 1000) : null,
  })
  if (result.error || !result.data) throw new ProfileError('publish_conflict')
  await notify(result.data, 'プロフィールが運営に承認され、選択した範囲で公開されました')
}
export async function adminReject({ adminId, versionId, reason }: { adminId: string; versionId: string; reason: string }) {
  await adminClient(adminId)
  const clean = shortText(reason, 1000)
  if (!clean) throw new ProfileError('reason_required')
  const result = await createTalentBankServiceClient().rpc('reject_talent_version', { p_actor: adminId, p_version: versionId, p_reason: clean })
  if (result.error || !result.data) throw new ProfileError('publish_conflict')
  await notify(result.data, 'プロフィールの修正をお願いします。本人確認画面で理由をご確認ください')
}
export async function unpublish(input: { memberId: string; adminId?: never; profileId: string; reason: string } | { adminId: string; memberId?: never; profileId: string; reason: string }) {
  const actorId = input.adminId ?? input.memberId
  if (input.adminId) await adminClient(input.adminId)
  else await memberClient(actorId)
  const reason = shortText(input.reason, 1000)
  if (!reason) throw new ProfileError('reason_required')
  const result = await createTalentBankServiceClient().rpc('unpublish_talent_profile', { p_actor: actorId, p_profile: input.profileId, p_reason: reason })
  if (result.error || !result.data) throw new ProfileError('publish_conflict')
  await notify(result.data, 'プロフィールの公開を停止しました')
}
