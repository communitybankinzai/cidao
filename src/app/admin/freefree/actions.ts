'use server'

// 管理画面「FreeFree掲示板の管理」の操作。
// サンプル投稿の片付けと、迷惑投稿・不適切投稿への対応に使う。
//
// 非公開（status='removed'）を既定の手段にしている。誤操作をすぐ戻せるうえ、
// 何を落としたかの記録が残るため。完全削除は元に戻せないので確認を挟む。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { pathsInBucket } from '@/lib/storage-path'

const FREEFREE_BUCKET = 'freefree-images'

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

// 掲載に添付された画像だけをストレージから消す。掲載の記録（誰がいつ何を出したか）は残る。
// 不適切な写真は「掲載を隠す」だけでは URL を知る人に見られ続けるため、画像自体を消す手段を分けている。
//
// 戻り値の残数が 0 でない場合は、消しきれなかった画像がある（URLの形が想定外など）。
export async function deleteFreefreeImages(postId: string): Promise<{ deleted: number; remaining: number }> {
  const { supabase } = await requireCommittee()

  const { data: post, error: readErr } = await supabase
    .from('freefree_posts')
    .select('id, images')
    .eq('id', postId)
    .maybeSingle()
  if (readErr) throw new Error(`掲載を読み込めませんでした: ${readErr.message}`)
  if (!post) throw new Error('掲載が見つかりません')

  const urls = (post.images as string[] | null) ?? []
  if (urls.length === 0) return { deleted: 0, remaining: 0 }

  const paths = pathsInBucket(urls, FREEFREE_BUCKET)
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(FREEFREE_BUCKET).remove(paths)
    if (rmErr) throw new Error(`画像を削除できませんでした: ${rmErr.message}`)
  }

  // 解釈できなかったURL（別バケット・想定外の形）は消せていないので掲載側に残す。
  // 全部消せた場合だけ images を空にする。
  const remaining = urls.length - paths.length
  const { error: updErr } = await supabase
    .from('freefree_posts')
    .update({ images: remaining > 0 ? urls.filter((u) => pathsInBucket([u], FREEFREE_BUCKET).length === 0) : null })
    .eq('id', postId)
  if (updErr) throw new Error(`画像の削除は済みましたが掲載の更新に失敗しました: ${updErr.message}`)

  revalidateAll(postId)
  return { deleted: paths.length, remaining }
}

// 完全に削除する。クーポン・応援も一緒に消える（DB側の on delete cascade）。
// 画像はストレージに残ってしまうため、行を消す前に片付ける。
// 元に戻せないため、UI 側で確認を挟んでから呼ぶこと。
export async function deleteFreefreePost(postId: string) {
  const { supabase } = await requireCommittee()

  // 先に画像を消す。行を消したあとでは images を辿れなくなるため順序が重要。
  // 画像の削除に失敗しても掲載本体は消せるようにする（残骸より露出の停止を優先）。
  const { data: post } = await supabase
    .from('freefree_posts')
    .select('images')
    .eq('id', postId)
    .maybeSingle()
  const paths = pathsInBucket((post?.images as string[] | null) ?? [], FREEFREE_BUCKET)
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(FREEFREE_BUCKET).remove(paths)
    if (rmErr) console.warn('[admin/freefree] image cleanup failed:', rmErr.message)
  }

  const { error } = await supabase.from('freefree_posts').delete().eq('id', postId)
  if (error) throw new Error(`削除できませんでした: ${error.message}`)

  // sns_rotation に行が残るが、pick_next_sns_targets() は freefree_posts を
  // join しているため候補には出てこない。放置で問題ない。

  revalidateAll(postId)
}
