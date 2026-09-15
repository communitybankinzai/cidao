'use server'
import { revalidatePath } from 'next/cache'
import { adminDraftIntro, adminSaveIntro } from '@/lib/talent-bank/cbi-intro'
import { sessionMember } from '@/lib/talent-bank/profile/access'
import { ProfileError } from '@/lib/talent-bank/profile/validation'

// 運営：他己紹介の AI 下書き／保存／本人への確認依頼（2026-09-15）
export async function introAdminAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId: adminId } = await sessionMember()
    const memberId = String(form.get('memberId') ?? '')
    const intent = String(form.get('intent') ?? '')
    if (intent === 'draft') await adminDraftIntro({ adminId, memberId })
    else {
      const minutes = Number(String(form.get('minutes') ?? '').trim())
      if (!Number.isInteger(minutes)) return { error: '一読にかかった分数を入力してください。' }
      await adminSaveIntro({ adminId, memberId, body: String(form.get('body') ?? ''), minutes, request: intent === 'request' })
    }
  } catch (error) {
    const messages: Record<string, string> = { invalid_text: `本文は1〜400字にしてください。`, profile_not_published: 'この人のプロフィールは公開されていません。' }
    return { error: error instanceof ProfileError && messages[error.reason] ? messages[error.reason] : '処理できませんでした。時間をおいて再度お試しください。' }
  }
  for (const p of ['/admin/talent-bank', '/me/talent']) revalidatePath(p)
  revalidatePath('/talent/[id]', 'page')
  return { error: '' }
}
