import 'server-only'
import { insertNotification } from '@/lib/notify'
import { createTalentBankServiceClient } from '../db'
import { memberClient } from '../interview/access'
import { adminClient } from './access'
import { ProfileError, shortText } from './validation'
import { syncLegacyPr } from './legacy-pr'
import { queueVideo } from '../video/jobs'

async function notify(recipientId: string, title: string) {
  await insertNotification({ recipientId, kind: 'member', title, linkUrl: '/me/talent' })
}
// 承認した版の公開範囲に合わせて、旧表（声がけ受付の置き場）を同期する。行が無い人には既定の行も作る。詳細は legacy-pr.ts
async function syncLegacyAfterApprove(memberId: string, versionId: string) {
  try {
    const db = createTalentBankServiceClient()
    const version = await db.from('talent_profile_versions').select('public_scope').eq('id', versionId).maybeSingle()
    if (version.data?.public_scope) await syncLegacyPr(db, memberId, version.data.public_scope)
  } catch { console.error('[talent-bank] legacy pr sync after approve failed') }
}
export async function adminApprove({ adminId, versionId, minutes, editCount, note }: { adminId: string; versionId: string; minutes: number; editCount: number; note?: string }) {
  await adminClient(adminId)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || !Number.isInteger(editCount) || editCount < 0) throw new ProfileError('invalid_work_log')
  const result = await createTalentBankServiceClient().rpc('publish_talent_version', {
    p_actor: adminId, p_version: versionId, p_minutes: minutes, p_edits: editCount, p_note: note ? shortText(note, 1000) : null,
  })
  if (result.error || !result.data) throw new ProfileError('publish_conflict')
  await syncLegacyAfterApprove(result.data, versionId)
  await notify(result.data, 'プロフィールが運営に承認され、選択した範囲で公開されました')
  // 自己紹介が公開されるたびに紹介動画を自動で作り直す（2026-09-15 中司さん）。写真が無ければ何もしない。失敗しても公開は成立
  try { await queueVideo({ memberId: result.data, trigger: 'profile_published' }) }
  catch { console.error('[talent-bank] auto video queue failed') }
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
  await syncLegacyPr(createTalentBankServiceClient(), result.data, null)
  await notify(result.data, 'プロフィールの公開を停止しました')
}
// 本人が公開中のプロフィールの公開範囲だけを変える（承認のやり直しは不要）。旧表の公開範囲も合わせる。
// 以前は me/talent/actions.ts の settingsAction に直書きだったものを、旧表の同期とあわせてテストできるようここへ移した
export async function changePublishedScope({ memberId, scope }: { memberId: string; scope: 'public' | 'registered_only' }) {
  const db = createTalentBankServiceClient()
  const profile = await db.from('talent_profiles').select('id, current_version_id').eq('member_id', memberId).maybeSingle()
  if (profile.error || !profile.data?.current_version_id) throw new ProfileError('profile_not_published')
  const results = await Promise.all([
    db.from('talent_profiles').update({ public_scope: scope }).eq('id', profile.data.id),
    db.from('talent_profile_versions').update({ public_scope: scope }).eq('id', profile.data.current_version_id),
    db.from('publications').update({ scope }).eq('profile_id', profile.data.id).is('unpublished_at', null),
  ])
  if (results.some(r => r.error)) throw new ProfileError('storage_unavailable')
  await syncLegacyPr(db, memberId, scope)
}
// 公開申請を運営（admin_role あり・退会していない）全員へベル通知＋Webプッシュで知らせる。
// 失敗しても申請自体は成立させる。本文・連絡先はログに出さない。
export async function notifyAdminsOfApplication(versionId: string) {
  try {
    const db = createTalentBankServiceClient()
    const [version, admins] = await Promise.all([
      db.from('talent_profile_versions').select('fields_json').eq('id', versionId).maybeSingle(),
      db.from('members').select('id, deleted_at').not('admin_role', 'is', null),
    ])
    if (admins.error) throw new Error('admin lookup failed')
    const raw = (version.data?.fields_json?.display_name?.value ?? '').trim() || 'メンバー'
    const who = raw.endsWith('さん') ? raw : `${raw}さん`
    await Promise.allSettled((admins.data ?? []).filter(a => !a.deleted_at).map(a => insertNotification({
      recipientId: a.id, kind: 'member', title: `${who}が人材バンクのプロフィール公開を申請しました`,
      body: '管理画面で内容を確認し、承認または差し戻しをしてください', linkUrl: '/admin/talent-bank',
    })))
  } catch { console.error('[talent-bank] admin notification failed') }
}
