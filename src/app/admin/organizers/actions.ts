'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// 主催者名の名寄せ表（organizer_aliases）の操作。元の events.organizer_name_text は書き換えない。
// 管理者以外は何もできない（テーブルの RLS も is_admin() のみ許可）。

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!user || !isAdmin) throw new Error('権限がありません')
  return { supabase, user }
}

function parseStringList(raw: FormDataEntryValue | null, max: number): string[] {
  let v: unknown
  try {
    v = JSON.parse(String(raw ?? '[]'))
  } catch {
    throw new Error('入力の形式が正しくありません')
  }
  if (!Array.isArray(v) || v.length > max) throw new Error('入力の形式が正しくありません')
  return v.map((x) => {
    if (typeof x !== 'string' || x.length > 300) throw new Error('入力の形式が正しくありません')
    return x
  })
}

/**
 * 2つ（以上）のまとまりを、1つの名前（まとめ先）にまとめる。
 * keys … まとめる自動キー全部（両方のまとまりの分）／olds … いまのまとめ先の名前（あれば。名前を付け替える）／canonical … まとめ先の名前
 */
export async function mergeOrganizerGroups(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAdmin()
  const canonical = String(formData.get('canonical') ?? '').trim()
  if (canonical.length < 1 || canonical.length > 200) throw new Error('まとめ先の名前は1〜200文字にしてください')
  const keys = [...new Set(parseStringList(formData.get('keys'), 300).filter((k) => k.length > 0))]
  if (keys.length < 1) throw new Error('まとめる対象がありません')
  const olds = [...new Set(parseStringList(formData.get('olds'), 50))].filter((o) => o && o !== canonical)

  const { error } = await supabase
    .from('organizer_aliases')
    .upsert(
      keys.map((alias_key) => ({ alias_key, canonical_name: canonical, created_by: user.id })),
      { onConflict: 'alias_key' },
    )
  if (error) throw new Error(`まとめの保存に失敗しました: ${error.message}`)

  // これまでのまとめ先の名前を使っていた行（いまは開催のない表記など）も、新しい名前へ付け替える
  if (olds.length > 0) {
    const { error: e2 } = await supabase.from('organizer_aliases').update({ canonical_name: canonical }).in('canonical_name', olds)
    if (e2) throw new Error(`名前の付け替えに失敗しました: ${e2.message}`)
  }

  revalidatePath('/admin/organizers')
}

/** 1つの表記（自動キー）をまとめから外す（名寄せ表の行を消す。元に戻せる＝もう一度まとめればよい）。 */
export async function unmergeOrganizerKey(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin()
  const aliasKey = String(formData.get('alias_key') ?? '')
  if (!aliasKey) throw new Error('対象がありません')
  const { error } = await supabase.from('organizer_aliases').delete().eq('alias_key', aliasKey)
  if (error) throw new Error(`解除に失敗しました: ${error.message}`)
  revalidatePath('/admin/organizers')
}

/** まとめ先の名前ごと、まとめを全部解除する。 */
export async function unmergeOrganizerGroup(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin()
  const canonical = String(formData.get('canonical') ?? '')
  if (!canonical) throw new Error('対象がありません')
  const { error } = await supabase.from('organizer_aliases').delete().eq('canonical_name', canonical)
  if (error) throw new Error(`解除に失敗しました: ${error.message}`)
  revalidatePath('/admin/organizers')
}
