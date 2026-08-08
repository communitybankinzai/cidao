'use server'

// 管理画面「FreeFree掲示板の管理」の操作。
// サンプル投稿の片付けと、迷惑投稿・不適切投稿への対応に使う。
//
// 非公開（status='removed'）を既定の手段にしている。誤操作をすぐ戻せるうえ、
// 何を落としたかの記録が残るため。完全削除は元に戻せないので確認を挟む。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

async function requireCommittee() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  // RLS 側も is_committee_or_super() で守られているが、UI 側でも早めに弾く
  const { data: me } = await supabase
    .from('members')
    .select('admin_role')
    .eq('id', user.id)
    .maybeSingle()
  const role = me?.admin_role as string | null | undefined
  if (role !== 'committee' && role !== 'super') throw new Error('権限がありません')
  return { supabase, user }
}

function revalidateAll(postId?: string) {
  revalidatePath('/admin/freefree')
  revalidatePath('/freefree')
  if (postId) revalidatePath(`/freefree/${postId}`)
}

// 非公開にする。一覧・詳細から消え、SNSローテーションの候補からも外れる
export async function hideFreefreePost(postId: string, note: string) {
  const { supabase, user } = await requireCommittee()

  const { error } = await supabase
    .from('freefree_posts')
    .update({
      status: 'removed',
      moderated_at: new Date().toISOString(),
      moderated_by: user.id,
      moderation_note: note.trim() || null,
    })
    .eq('id', postId)
  if (error) throw new Error(`非公開にできませんでした: ${error.message}`)

  revalidateAll(postId)
}

// 非公開を取り消して元に戻す
export async function restoreFreefreePost(postId: string) {
  const { supabase } = await requireCommittee()

  const { error } = await supabase
    .from('freefree_posts')
    .update({
      status: 'active',
      moderated_at: null,
      moderated_by: null,
      moderation_note: null,
    })
    .eq('id', postId)
  if (error) throw new Error(`元に戻せませんでした: ${error.message}`)

  revalidateAll(postId)
}

// 完全に削除する。クーポン・応援も一緒に消える（DB側の on delete cascade）。
// 元に戻せないため、UI 側で確認を挟んでから呼ぶこと。
export async function deleteFreefreePost(postId: string) {
  const { supabase } = await requireCommittee()

  const { error } = await supabase.from('freefree_posts').delete().eq('id', postId)
  if (error) throw new Error(`削除できませんでした: ${error.message}`)

  // sns_rotation に行が残るが、pick_next_sns_targets() は freefree_posts を
  // join しているため候補には出てこない。放置で問題ない。

  revalidateAll(postId)
}
