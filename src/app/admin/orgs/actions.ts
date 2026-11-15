'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { buildVisibilityUpdate } from '@/lib/org-visibility'

// 非公開の団体は RLS で運営にも見えない（見えるのは公開中の団体と、自分が所属する団体だけ）。
// そのため読み書きは service_role で行い、その前に必ず運営委員・統括であることを確かめる。
function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('サーバー設定エラー（service role 未設定）')
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function assertCommitteeOrSuper() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  // 団体の更新・削除と同じ権限（RLS の orgs_update_admin と合わせる）
  const { data: ok } = await supabase.rpc('is_committee_or_super')
  if (!ok) throw new Error('運営委員の権限が必要です')
}

/**
 * 運営が、団体の公開・非公開を切り替える。
 * 非公開にしても削除はしない（団体の情報・所属はそのまま残り、あとで公開に戻せる）。
 * 公開に戻しても「新しい団体」の通知は出さない（新着ではないため）。
 */
export async function setOrgVisibility(orgId: string, makePublic: boolean, reason: string) {
  if (!/^[0-9a-f-]{36}$/.test(orgId)) throw new Error('団体の指定が正しくありません')
  await assertCommitteeOrSuper()

  const built = buildVisibilityUpdate(makePublic, reason)
  if (!built.ok) throw new Error(built.error)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organizations')
    .update({ ...built.update, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('id')
  if (error) throw new Error(`切り替えに失敗しました: ${error.message}`)
  if (!data || data.length === 0) throw new Error('団体が見つかりません')

  revalidatePath('/admin/orgs')
  revalidatePath('/admin/claims')
  revalidatePath('/orgs')
  revalidatePath(`/orgs/${orgId}`)
}
