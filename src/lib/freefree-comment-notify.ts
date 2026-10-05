// FreeFree の応援メッセージ（コメント）を、掲載者へ通知する（2026-10-05）。
// これまでコメントは掲載ページの下に出るだけで、掲載者はページを開かないと気づけなかった。
//   - 個人・個人事業の掲載 → 掲載した本人
//   - 団体の掲載 → その団体の代表者と所属メンバー（確認済み・未脱退）
// 通知はベル＋Webプッシュ（insertNotification）。自分のコメントは通知しない。
// best-effort：通知の失敗でコメント自体は失敗させない（呼び出し側は after() で回す）。

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { insertNotification } from '@/lib/notify'

const PREVIEW_CHARS = 60

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, { auth: { persistSession: false } })
}

/** 通知に載せる本文の冒頭。改行は空白にし、長ければ「…」で切る */
export function commentPreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : flat
}

/** 通知する相手（退会済みは除く）。コメントした本人は呼び出し側で除く */
export async function freefreeCommentRecipients(
  admin: SupabaseClient,
  post: { poster_type: string; poster_id: string },
): Promise<string[]> {
  let ids: string[]
  if (post.poster_type === 'org') {
    const [{ data: org }, { data: members }] = await Promise.all([
      admin.from('organizations').select('representative_id').eq('id', post.poster_id).maybeSingle(),
      admin
        .from('memberships')
        .select('member_id')
        .eq('org_id', post.poster_id)
        .eq('status', 'confirmed')
        .is('left_at', null),
    ])
    ids = [org?.representative_id as string | null | undefined, ...((members ?? []).map((m) => m.member_id as string))]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
  } else {
    ids = [post.poster_id]
  }
  ids = Array.from(new Set(ids))
  if (ids.length === 0) return []
  const { data: alive } = await admin.from('members').select('id').in('id', ids).is('deleted_at', null)
  return (alive ?? []).map((m) => m.id as string)
}

export async function notifyFreefreeComment(input: {
  postId: string
  commenterId: string
  body: string
}): Promise<void> {
  try {
    const admin = adminClient()
    if (!admin) return
    const { data: post } = await admin
      .from('freefree_posts')
      .select('poster_type, poster_id, title')
      .eq('id', input.postId)
      .maybeSingle()
    if (!post) return

    const recipients = (await freefreeCommentRecipients(admin, post as { poster_type: string; poster_id: string }))
      .filter((id) => id !== input.commenterId)
    if (recipients.length === 0) return

    const { data: actor } = await admin.from('members').select('display_name').eq('id', input.commenterId).maybeSingle()
    // 表示名に「さん」を含む人が多いので、敬称は付けない
    const name = ((actor?.display_name as string | null | undefined) ?? '').trim() || '会員の方'

    for (const recipientId of recipients) {
      await insertNotification({
        recipientId,
        actorId: input.commenterId,
        kind: 'comment',
        title: `FreeFree「${String(post.title)}」に応援メッセージが届きました`,
        body: `${name}：${commentPreview(input.body)}`,
        linkUrl: `/freefree/${input.postId}`,
      })
    }
  } catch (e) {
    console.error('[freefree-comment-notify] failed:', e instanceof Error ? e.message : e)
  }
}
