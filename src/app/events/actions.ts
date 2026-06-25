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
  // '__member__' (個人) | '__external__' (未登録) | <organizations.id UUID>
  organizer_choice: string
  organizer_name_text?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function createEvent(input: CreateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // organizer_choice を解釈し、events 行の組み立てに必要なフィールドを決める
  let organizer_type: 'member' | 'org'
  let organizer_id: string
  let name_text: string | null = null
  let isProxy = false

  if (input.organizer_choice === '__member__') {
    organizer_type = 'member'
    organizer_id = user.id
  } else if (input.organizer_choice === '__external__') {
    organizer_type = 'member'
    organizer_id = user.id
    name_text = input.organizer_name_text?.trim() || null
    if (!name_text) throw new Error('未登録団体名を入力してください')
    isProxy = true
  } else if (UUID_RE.test(input.organizer_choice)) {
    const orgId = input.organizer_choice
    // ユーザーが当該団体の代表/役員（confirmed）であるかチェック
    const { data: mem } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('member_id', user.id)
      .eq('status', 'confirmed')
      .in('role', ['representative', 'officer'])
      .maybeSingle()
    if (mem) {
      // 正規の団体イベント
      organizer_type = 'org'
      organizer_id = orgId
    } else {
      // 非メンバーが既存登録団体名義で登録 → proxy 扱い。名称は organizations.name から取って organizer_name_text に。
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle()
      if (!org) throw new Error('指定された団体が見つかりません')
      organizer_type = 'member'
      organizer_id = user.id
      name_text = org.name
      isProxy = true
    }
  } else {
    throw new Error('主催者の指定が不正です')
  }

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
      organizer_type,
      organizer_id,
      organizer_name_text: name_text,
      proxy_registration: isProxy,
      proxy_source_url: isProxy ? 'https://cidao.vercel.app/events/new' : null,
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
