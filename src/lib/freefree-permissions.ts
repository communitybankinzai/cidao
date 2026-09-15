// FreeFree 掲載を編集できるかの判定（2026-09-16）。
// 編集画面・詳細ページの「編集する」ボタン・保存処理（freefree/actions.ts）で共通に使う。
// 判定は DB の update ポリシー（freefree_update_poster / freefree_update_admin）とそろえている:
//   - 個人・個人事業の掲載 → 掲載した本人
//   - 団体の掲載 → その団体の代表者・所属確定メンバー（is_org_member）
//   - 運営者（committee / super）→ すべての掲載
import type { createClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

export async function canEditFreefreePost(
  supabase: Client,
  userId: string,
  post: { poster_type: string; poster_id: string },
): Promise<boolean> {
  if ((post.poster_type === 'member' || post.poster_type === 'individual_business') && post.poster_id === userId) {
    return true
  }
  if (post.poster_type === 'org') {
    const { data: isMember } = await supabase.rpc('is_org_member', { org: post.poster_id })
    if (isMember === true) return true
  }
  const { data } = await supabase.from('members').select('admin_role').eq('id', userId).maybeSingle()
  return data?.admin_role === 'committee' || data?.admin_role === 'super'
}
