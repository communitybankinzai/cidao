import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { ProfileError } from '@/lib/talent-bank/profile/validation'
import { addPhoto, removePhoto } from '@/lib/talent-bank/video/jobs'

// 紹介動画用の写真の登録（1回1枚・multipart）と削除（2026-09-15）。
// サーバーアクションの本文上限（1MB）を避けるため API にした。写真はブラウザ側で縮めてから送られてくる。
const MESSAGES: Record<string, string> = {
  invalid_photo: '写真として読めませんでした（JPEG・PNG・WebP、12MB まで）。', too_many_photos: '写真は12枚までです。',
  unauthorized: 'ログインしてください。', storage_unavailable: '保存できませんでした。時間をおいて再度お試しください。',
}
const fail = (error: unknown) => NextResponse.json({ error: error instanceof ProfileError ? MESSAGES[error.reason] ?? MESSAGES.storage_unavailable : MESSAGES.storage_unavailable },
  { status: error instanceof ProfileError && error.reason === 'unauthorized' ? 401 : 400 })

async function viewer() {
  const db = await createTalentBankClient()
  const { data } = await db.auth.getUser()
  if (!data.user) throw new ProfileError('unauthorized')
  return data.user.id
}
export async function POST(request: Request) {
  try {
    const memberId = await viewer()
    const form = await request.formData()
    const file = form.get('photo')
    if (!(file instanceof File)) throw new ProfileError('invalid_photo')
    const id = await addPhoto({ memberId, bytes: Buffer.from(await file.arrayBuffer()) })
    revalidatePath('/me/talent')
    return NextResponse.json({ id })
  } catch (error) { return fail(error) }
}
export async function DELETE(request: Request) {
  try {
    const memberId = await viewer()
    const { photoId } = await request.json() as { photoId?: string }
    if (!photoId) throw new ProfileError('photo_unavailable')
    await removePhoto({ memberId, photoId })
    revalidatePath('/me/talent')
    return NextResponse.json({ ok: true })
  } catch (error) { return fail(error) }
}
