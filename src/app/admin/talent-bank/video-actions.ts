'use server'
import { revalidatePath } from 'next/cache'
import { sessionMember } from '@/lib/talent-bank/profile/access'
import { adminPublishVideo, retireVideo } from '@/lib/talent-bank/video/jobs'

// 運営：本人が承認した紹介動画を掲載する／掲載中のものを下げる（2026-09-15）
export async function videoModerateAction(_previous: { error: string }, form: FormData) {
  try {
    const { memberId } = await sessionMember()
    const videoId = String(form.get('videoId') ?? '')
    if (form.get('intent') === 'retire') await retireVideo({ actorId: memberId, videoId, asAdmin: true })
    else {
      const minutes = Number(String(form.get('minutes') ?? '').trim())
      if (!Number.isInteger(minutes)) return { error: '確認にかかった分数を入力してください。' }
      await adminPublishVideo({ adminId: memberId, videoId, minutes })
    }
  } catch { return { error: '処理できませんでした。動画の状態を確認してください。' } }
  for (const p of ['/admin/talent-bank', '/me/talent', '/talent']) revalidatePath(p)
  revalidatePath('/talent/[id]', 'page')
  return { error: '' }
}
