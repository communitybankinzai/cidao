'use server'
import { revalidatePath } from 'next/cache'
import { adminClient, sessionMember } from '@/lib/talent-bank/profile/access'
import { adminApprove, adminReject } from '@/lib/talent-bank/profile/publish'
export async function moderateAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const db = await adminClient(memberId)
    const versionId = String(form.get('versionId') ?? '')
    if (form.get('intent') === 'reject') await adminReject({ adminId: memberId, versionId, reason: String(form.get('reason') ?? '') })
    else {
      const input = String(form.get('minutes') ?? '').trim()
      if (!input) return { error: '確認にかかった分数を入力してください。' }
      const version = await db.from('talent_profile_versions').select('edited_by_owner_at').eq('id', versionId).single()
      if (version.error || !version.data) return { error: '版を確認できませんでした。' }
      await adminApprove({ adminId: memberId, versionId, minutes: Number(input), editCount: version.data.edited_by_owner_at ? 1 : 0 })
    }
  } catch { return { error: '処理できませんでした。分数・差し戻し理由・承認待ちの状態を確認してください。' } }
  for (const p of ['/admin/talent-bank', '/me/talent', '/talent']) revalidatePath(p)
  revalidatePath('/talent/[id]', 'page')
  return { error: '' }
}
