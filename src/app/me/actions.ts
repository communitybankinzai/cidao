'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// 退会（ソフトデリート）。仕様書 v2.1 §4.4：退会から30日以内は復元可。
// 30日経過後の物理削除（匿名化）バッチは未実装のため、それまでは
// 再ログイン時に auth/callback で deleted_at をクリアして復元する運用。
export async function deleteAccount() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  // 団体代表者のまま退会すると organizations.representative_id が宙に浮くためブロック
  const { data: repOrgs } = await supabase
    .from('organizations')
    .select('name')
    .eq('representative_id', user.id)
    .limit(1)
  if (repOrgs && repOrgs.length > 0) {
    throw new Error(`団体「${repOrgs[0].name}」の代表者のため退会できません。先に管理者へ代表者の変更を依頼してください`)
  }

  const { error } = await supabase
    .from('members')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) throw new Error(`退会処理に失敗: ${error.message}`)

  await supabase.auth.signOut()
  redirect('/login?deleted=1')
}

type ProfileUpdate = {
  display_name: string
  real_name?: string | null     // 非公開（member_private テーブル）。受付での本人確認用
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

  // 実名（非公開）は member_private に upsert（RLS: 本人のみ書込可）
  if (input.real_name !== undefined) {
    const realName = input.real_name?.trim().slice(0, 50) || null
    const { error: privErr } = await supabase
      .from('member_private')
      .upsert(
        { member_id: user.id, real_name: realName, updated_at: new Date().toISOString() },
        { onConflict: 'member_id' },
      )
    if (privErr) throw new Error(`実名の保存に失敗: ${privErr.message}`)
  }

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
