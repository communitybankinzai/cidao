'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { periodToDays } from '@/lib/freefree-categories'

type CreateInput = {
  poster_type: 'member' | 'individual_business'
  title: string
  body: string
  category: string
  location?: string
  period: 'p_1week' | 'p_1month' | 'p_3months'
}

export async function createFreefreePost(input: CreateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const expires_at = new Date(Date.now() + periodToDays(input.period) * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('freefree_posts')
    .insert({
      poster_type: input.poster_type,
      poster_id: user.id,
      title: input.title,
      body: input.body,
      category: input.category,
      location: input.location ?? null,
      period: input.period,
      status: 'active',
      expires_at,
    })
    .select('id')
    .single()
  if (error) throw new Error(`掲載失敗: ${error.message}`)
  revalidatePath('/freefree')
  redirect(`/freefree/${data.id}`)
}

export async function likeFreefree(postId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { error } = await supabase.from('supports').insert({
    post_id: postId, member_id: user.id, kind: 'like',
  })
  if (error && !error.message.includes('duplicate')) throw new Error(`応援失敗: ${error.message}`)
  revalidatePath(`/freefree/${postId}`)
}

export async function commentFreefree(postId: string, body: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  if (body.trim().length < 1) throw new Error('応援メッセージを入力してください')
  const { error } = await supabase.from('supports').insert({
    post_id: postId, member_id: user.id, kind: 'comment', body: body.trim(),
  })
  if (error) throw new Error(`コメント失敗: ${error.message}`)
  revalidatePath(`/freefree/${postId}`)
}
