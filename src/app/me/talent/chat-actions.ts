'use server'
import { revalidatePath } from 'next/cache'
import { sessionMember } from '@/lib/talent-bank/profile/access'
import { editProfileByChat } from '@/lib/talent-bank/profile/edit-chat'
import { ProfileError } from '@/lib/talent-bank/profile/validation'

export type ChatResult = { ok: true; reply: string; changed: boolean } | { ok: false; error: string }

const MESSAGES: Record<string, string> = {
  invalid_text: '1000字以内で書いてください。',
  immutable_version: 'この版はもう直せません。「新しい版を作って編集」を押してください。',
  stale_version: '新しい版があります。画面を読み直してください。',
  save_conflict: '内容が更新されています。画面を読み直してください。',
  version_unavailable: 'プロフィールが見つかりません。画面を読み直してください。',
  unauthorized: 'ログインし直してください。',
}

// 確認画面の「話しかけて直す」欄から呼ぶ。本人のセッションで、本人の編集中の版だけを直す。
export async function editChatAction(versionId: string, message: string): Promise<ChatResult> {
  try {
    const { memberId } = await sessionMember()
    const result = await editProfileByChat({ memberId, versionId, message })
    if (result.changed) revalidatePath('/me/talent')
    return { ok: true, ...result }
  } catch (error) {
    const reason = error instanceof ProfileError ? error.reason : 'ai_or_server'
    return { ok: false, error: MESSAGES[reason] ?? `うまく直せませんでした。時間をおいてもう一度お試しください（${reason}）。` }
  }
}
