'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { jstLocalToUtcIso } from '@/lib/datetime'

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
  flyer_image_url?: string
  website_url?: string
  form_url?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Occurrence = { start_at: string; end_at: string }

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type OrganizerResolution = {
  organizer_type: 'member' | 'org'
  organizer_id: string
  name_text: string | null
  isProxy: boolean
  isUnknownOrganizer: boolean
}

// organizer_choice を解釈し、events 行の組み立てに必要なフィールドを決める。
// createEvent / updateEvent / createEventBulk で共通利用。
async function resolveOrganizer(
  supabase: SupabaseServerClient,
  user: { id: string },
  organizer_choice: string,
  organizer_name_text: string | undefined,
): Promise<OrganizerResolution> {
  const isUnknownOrganizer = organizer_choice === '__unknown__'

  if (organizer_choice === '__member__' || isUnknownOrganizer) {
    return {
      organizer_type: 'member',
      organizer_id: user.id,
      name_text: isUnknownOrganizer ? '主催者不明' : null,
      isProxy: isUnknownOrganizer,
      isUnknownOrganizer,
    }
  }

  if (organizer_choice === '__external__') {
    const name_text = organizer_name_text?.trim() || null
    if (!name_text) throw new Error('未登録団体名を入力してください')
    return { organizer_type: 'member', organizer_id: user.id, name_text, isProxy: true, isUnknownOrganizer: false }
  }

  if (UUID_RE.test(organizer_choice)) {
    const orgId = organizer_choice
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
      return { organizer_type: 'org', organizer_id: orgId, name_text: null, isProxy: false, isUnknownOrganizer: false }
    }
    // 非メンバーが既存登録団体名義で登録 → proxy 扱い。名称は organizations.name から取って organizer_name_text に。
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle()
    if (!org) throw new Error('指定された団体が見つかりません')
    return { organizer_type: 'member', organizer_id: user.id, name_text: org.name, isProxy: true, isUnknownOrganizer: false }
  }

  throw new Error('主催者の指定が不正です')
}

export async function createEvent(input: CreateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { organizer_type, organizer_id, name_text, isProxy, isUnknownOrganizer } =
    await resolveOrganizer(supabase, user, input.organizer_choice, input.organizer_name_text)

  const { data, error } = await supabase
    .from('events')
    .insert({
      title: input.title,
      description: input.description,
      category: input.category,
      start_at: jstLocalToUtcIso(input.start_at),
      end_at: jstLocalToUtcIso(input.end_at),
      location: input.location ?? null,
      online_flag: input.online_flag,
      capacity: input.capacity ?? null,
      fee: input.fee ?? null,
      organizer_type,
      organizer_id,
      organizer_name_text: name_text,
      proxy_registration: isProxy,
      proxy_source_url: isProxy ? 'https://cidao.vercel.app/events/new' : null,
      flyer_image_url: input.flyer_image_url?.trim() || null,
      website_url: input.website_url?.trim() || null,
      form_url: input.form_url?.trim() || null,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) throw new Error(`イベント作成失敗: ${error.message}`)

  // 主催者を participants の organizer として登録
  // ただし「主催者不明（情報提供者）」または「代理登録」の場合、登録者は主催者本人ではないので participant 登録はスキップ
  // （参加したい場合は別途イベント詳細ページの「参加する」を押してもらう）
  if (!isUnknownOrganizer && !isProxy) {
    await supabase.from('event_participants').insert({
      event_id: data.id,
      member_id: user.id,
      role: 'organizer',
    })
  }

  revalidatePath('/events')
  redirect(`/events/${data.id}`)
}

// チラシから複数日程（occurrences）が検出された場合に、同一内容のイベントをまとめて登録する。
export async function createEventBulk(input: CreateInput, occurrences: Occurrence[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { organizer_type, organizer_id, name_text, isProxy, isUnknownOrganizer } =
    await resolveOrganizer(supabase, user, input.organizer_choice, input.organizer_name_text)

  const list = occurrences.length > 0 ? occurrences : [{ start_at: input.start_at, end_at: input.end_at }]

  let firstId: string | null = null
  for (const occ of list) {
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: input.title,
        description: input.description,
        category: input.category,
        start_at: jstLocalToUtcIso(occ.start_at),
        end_at: jstLocalToUtcIso(occ.end_at),
        location: input.location ?? null,
        online_flag: input.online_flag,
        capacity: input.capacity ?? null,
        fee: input.fee ?? null,
        organizer_type,
        organizer_id,
        organizer_name_text: name_text,
        proxy_registration: isProxy,
        proxy_source_url: isProxy ? 'https://cidao.vercel.app/events/new' : null,
        flyer_image_url: input.flyer_image_url?.trim() || null,
        status: 'open',
      })
      .select('id')
      .single()
    if (error) throw new Error(`イベント作成失敗: ${error.message}`)
    firstId = firstId ?? data.id

    if (!isUnknownOrganizer && !isProxy) {
      await supabase.from('event_participants').insert({
        event_id: data.id,
        member_id: user.id,
        role: 'organizer',
      })
    }
  }

  revalidatePath('/events')
  redirect(`/events/${firstId}`)
}

type UpdateInput = {
  id: string
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
  flyer_image_url?: string | null
  website_url?: string
  form_url?: string
}

export async function updateEvent(input: UpdateInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // organizer 関連の解釈は createEvent と共通のヘルパーを使う
  const { organizer_type, organizer_id, name_text, isProxy, isUnknownOrganizer } =
    await resolveOrganizer(supabase, user, input.organizer_choice, input.organizer_name_text)

  const { error } = await supabase
    .from('events')
    .update({
      title: input.title,
      description: input.description,
      category: input.category,
      start_at: jstLocalToUtcIso(input.start_at),
      end_at: jstLocalToUtcIso(input.end_at),
      location: input.location ?? null,
      online_flag: input.online_flag,
      capacity: input.capacity ?? null,
      fee: input.fee ?? null,
      organizer_type,
      organizer_id,
      organizer_name_text: name_text,
      proxy_registration: isProxy,
      proxy_source_url: isProxy ? 'https://cidao.vercel.app/events/new' : null,
      website_url: input.website_url?.trim() || null,
      form_url: input.form_url?.trim() || null,
      // input.flyer_image_url が undefined のときは触らない（"" の場合のみ NULL クリア）
      ...(input.flyer_image_url === undefined
        ? {}
        : { flyer_image_url: input.flyer_image_url?.trim() || null }),
    })
    .eq('id', input.id)
  if (error) throw new Error(`イベント更新失敗: ${error.message}`)

  // 「主催者不明」に変更した場合、自分の participant ロールが organizer のままだと
  // 「主催者として登録中」表示が残ってしまうため、participant に格下げする。
  // event_participants に直接 UPDATE できる RLS ポリシーは無いため、
  // SECURITY DEFINER の manage_event_participant RPC を使う。
  if (isUnknownOrganizer) {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('manage_event_participant', {
      p_event_id: input.id,
      p_member_id: user.id,
      p_role: 'participant',
      p_attended: null,
    })
    if (rpcError || (rpcResult && rpcResult.ok === false)) {
      throw new Error(`参加者ロールの更新失敗: ${rpcError?.message ?? rpcResult?.error}`)
    }
  }

  revalidatePath('/events')
  revalidatePath(`/events/${input.id}`)
  redirect(`/events/${input.id}`)
}

export async function deleteEvent(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // 削除可否は RLS の events_delete_organizer ポリシー（can_edit_event or is_committee_or_super）が担保
  const { error } = await supabase.from('events').delete().eq('id', eventId)
  if (error) throw new Error(`イベント削除失敗: ${error.message}`)

  revalidatePath('/events')
  redirect('/events')
}

// 写真投稿者の claim：ログインユーザーが「未claim の取り込みイベント」を自分の投稿として申告。
// SECURITY DEFINER の claim_event() が submitter セット＋情報提供ポイント(10pt)付与を行う。
export async function claimEvent(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { error } = await supabase.rpc('claim_event', { p_event_id: eventId })
  if (error) throw new Error(`情報提供の登録に失敗: ${error.message}`)
  revalidatePath(`/events/${eventId}`)
}

// 主催者/管理者がイベント参加者の役割・出欠を更新する。
// 出欠を true にすると award_on_event_attendance トリガーが役割に応じてポイントを付与
// （主催 40 / スタッフ 20 / 参加 5）。authz は SECURITY DEFINER 関数内の can_edit_event。
export async function manageParticipant(
  eventId: string,
  memberId: string,
  role: 'participant' | 'staff' | null,
  attended: boolean | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { error } = await supabase.rpc('manage_event_participant', {
    p_event_id: eventId,
    p_member_id: memberId,
    p_role: role,
    p_attended: attended,
  })
  if (error) throw new Error(`出欠・役割の更新に失敗: ${error.message}`)
  revalidatePath(`/events/${eventId}`)
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
