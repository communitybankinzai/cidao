'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * イベント主催名を市民活動団体として仮登録する。
 * 代表者は空のままにするため、団体ページには「代表者による更新待ち」が表示され、
 * 本人が /me/edit から代表者申告 → /admin/claims の承認で確定する。
 */
export async function registerOrgCandidate(name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('団体名が空です')

  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')

  // 同名が既にあれば何もしない
  const { data: exists } = await supabase
    .from('organizations')
    .select('id')
    .eq('name', trimmed)
    .maybeSingle()
  if (exists) return { alreadyExists: true, id: exists.id }

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      name: trimmed,
      type: 'civic_group' as const,
      public_flag: true,
      representative_id: null,
      description:
        'CiDAO に登録されたイベントの主催者名から作成した暫定の団体ページです。' +
        '団体の代表者・役員の方は、CiDAO にログイン後「プロフィール編集 → 所属団体」から' +
        'この団体を追加し代表者申告をしてください。承認後、このページを直接編集できるようになります。',
    })
    .select('id')
    .single()
  if (error) throw new Error(`団体の仮登録に失敗しました: ${error.message}`)

  revalidatePath('/admin/org-candidates')
  revalidatePath('/orgs')
  return { alreadyExists: false, id: org.id }
}

/** 市民活動団体ではない主催名（企業・行政・媒体名など）を候補一覧から外す。 */
export async function excludeOrgCandidate(name: string, reason: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('団体名が空です')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin || !user) throw new Error('権限がありません')

  const { error } = await supabase
    .from('org_name_exclusions')
    .insert({ name: trimmed, reason: reason || null, excluded_by: user.id })
  if (error) throw new Error(`除外の記録に失敗しました: ${error.message}`)

  revalidatePath('/admin/org-candidates')
}

/** 除外を取り消して候補一覧に戻す。 */
export async function undoExcludeOrgCandidate(name: string) {
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')

  const { error } = await supabase.from('org_name_exclusions').delete().eq('name', name)
  if (error) throw new Error(`除外の取り消しに失敗しました: ${error.message}`)

  revalidatePath('/admin/org-candidates')
}
