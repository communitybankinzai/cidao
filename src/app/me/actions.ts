'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type ProfileUpdate = {
  display_name: string
  residency_type: 'citizen' | 'related_population'
  relation_type?: string | null
  interests: string[]
  self_introduction?: string | null
  skills_text?: string | null
  contact_permission: boolean
  collaboration_consent: boolean
  ranking_opt_in: boolean
  proposal_email: boolean       // 提案・投票のメール通知（contact_preferences.proposal_email）
  upgradeToEmailOnly: boolean   // 本登録時 true（tier='email_only' に昇格）
}

export async function updateProfile(input: ProfileUpdate) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // 興味分野は最低1件必須
  if (!input.interests || input.interests.length === 0) {
    throw new Error('興味分野を1つ以上選択してください')
  }
  if (input.display_name.trim().length === 0) {
    throw new Error('表示名を入力してください')
  }

  // contact_preferences は jsonb 丸ごと更新になるため、既存キーを保持してマージする
  const { data: current } = await supabase
    .from('members')
    .select('contact_preferences')
    .eq('id', user.id)
    .single()
  const prefs = {
    ...((current?.contact_preferences ?? {}) as Record<string, unknown>),
    proposal_email: input.proposal_email,
  }

  const update: Record<string, unknown> = {
    display_name: input.display_name.trim(),
    residency_type: input.residency_type,
    relation_type: input.relation_type ?? null,
    interests: input.interests,
    self_introduction: input.self_introduction ?? null,
    skills_text: input.skills_text ?? null,
    contact_permission: input.contact_permission,
    collaboration_consent: input.collaboration_consent,
    ranking_opt_in: input.ranking_opt_in,
    contact_preferences: prefs,
  }

  if (input.upgradeToEmailOnly) {
    update.tier = 'email_only'
  }

  const { error } = await supabase
    .from('members')
    .update(update)
    .eq('id', user.id)

  if (error) throw new Error(`プロフィール更新に失敗: ${error.message}`)

  revalidatePath('/me')
}

export async function updatePublicSettings(publicSettings: Record<string, 'public' | 'members_only' | 'consent_only' | 'private'>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { error } = await supabase
    .from('members')
    .update({ public_settings: publicSettings })
    .eq('id', user.id)

  if (error) throw new Error(`公開範囲設定に失敗: ${error.message}`)
  revalidatePath('/me')
}
