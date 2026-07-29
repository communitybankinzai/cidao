'use server'

// 管理画面「一斉お知らせ」。登録メンバー全員のベル🔔＋Webプッシュへ配信する。
// 送信できるのは管理者のみ（is_admin RPC で判定）。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyAllMembers } from '@/lib/notify'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  return { supabase, user }
}

export type SendNoticeResult =
  | { ok: true; recipients: number; pushed: number }
  | { ok: false; error: string }

export async function sendBroadcastNotice(input: {
  title: string
  body?: string
  linkUrl?: string
  push: boolean
}): Promise<SendNoticeResult> {
  try {
    await requireAdmin()

    const title = input.title.trim()
    if (title.length < 1) return { ok: false, error: 'お知らせのタイトルを入力してください' }
    if (title.length > 200) return { ok: false, error: 'タイトルは200字以内にしてください' }

    const body = input.body?.trim() || undefined
    if (body && body.length > 1000) return { ok: false, error: '本文は1000字以内にしてください' }

    // リンクはアプリ内パスのみ許可（外部URLをプッシュから開かせない）
    const linkUrl = input.linkUrl?.trim() || undefined
    if (linkUrl && !linkUrl.startsWith('/')) {
      return { ok: false, error: 'リンクは「/events」のようにサイト内のパスで入力してください' }
    }

    // actorId は渡さない＝送信した管理者自身にも届く（送信確認を兼ねる）
    const result = await notifyAllMembers({
      kind: 'system',
      title,
      body,
      linkUrl,
      push: input.push,
    })

    if (result.recipients === 0) {
      return { ok: false, error: '送信できませんでした（宛先0件、または通知設定が未構成です）' }
    }

    revalidatePath('/admin/notice')
    return { ok: true, recipients: result.recipients, pushed: result.pushed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '送信に失敗しました' }
  }
}
