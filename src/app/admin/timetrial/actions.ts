'use server'

// 管理画面「タイムトライアル記録」の削除・リセット操作。
// 記録テーブル metaverse_tt_trials は service_role のみアクセス可のため、
// 管理者確認のうえ service クライアントで操作する。

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  return user
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('サーバー接続が未設定です')
  return createSupabaseAdmin(url, key, { auth: { persistSession: false } })
}

export type TtActionResult = { ok: true } | { ok: false; error: string }

// 記録を1件削除する
export async function deleteTrial(id: string): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const { error } = await serviceClient()
      .from('metaverse_tt_trials')
      .delete()
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 全記録をリセットする（デモイベントのやり直し用）。取り消しはできない
export async function resetAllTrials(): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const { error } = await serviceClient()
      .from('metaverse_tt_trials')
      .delete()
      .not('id', 'is', null)
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
