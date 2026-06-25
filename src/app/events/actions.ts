'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type CreateInput = {
  title: string
  description: string
  category: string
  start_at: string
  end_at: string
  location?: string
  online_flag: boolean
  capacity?: number
  fee?: number
  organizer_type: 'member' | 'org'
  organizer_org_id?: string
}

export async function createEvent(input: CreateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const organizer_id = input.organizer_type === 'org' ? input.organizer_org_id : user.id
  if (!organizer_id) throw new Error('主催者が不正です')

  const { data, error } = await supabase
    .from('events')
    .insert({
      title: input.title,
      description: input.description,
      category: input.category,
      start_at: input.start_at,
      end_at: input.end_at,
      location: input.location ?? null,
      online_flag: input.online_flag,
      capacity: input.capacity ?? null,
      fee: input.fee ?? null,
      organizer_type: input.organizer_type,
      organizer_id,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) throw new Error(`イベント作成失敗: ${error.message}`)

  // 主催者を participants の organizer として登録
  await supabase.from('event_participants').insert({
    event_id: data.id,
    member_id: user.id,
    role: 'organizer',
  })

  revalidatePath('/events')
  redirect(`/events/${data.id}`)
}

export async function joinEvent(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase.from('event_participants').upsert(
    { event_id: eventId, member_id: user.id, role: 'participant' },
    { onConflict: 'event_id,member_id' }
  )
  if (error) throw new Error(`参加登録失敗: ${error.message}`)
  revalidatePath(`/events/${eventId}`)
}

export async function leaveEvent(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase
    .from('event_participants')
    .delete()
    .eq('event_id', eventId)
    .eq('member_id', user.id)
  if (error) throw new Error(`キャンセル失敗: ${error.message}`)
  revalidatePath(`/events/${eventId}`)
}

export async function markAttendance(eventId: string, memberId: string, attended: boolean) {
  // 主催者のみ呼び出し可（RLS で弾かれる）
  const supabase = await createClient()
  const { error } = await supabase
    .from('event_participants')
    .update({ attended })
    .eq('event_id', eventId)
    .eq('member_id', memberId)
  if (error) throw new Error(`出欠記録失敗: ${error.message}`)
  revalidatePath(`/events/${eventId}`)
}
