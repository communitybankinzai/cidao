import type { SupabaseClient } from '@supabase/supabase-js'

type OrgForPermission = {
  id: string
  representative_id: string | null
  contact_email: string | null
  name: string
}

// /orgs/[id]/edit で「編集できるか」を server で判定するためのヘルパー。
// 編集権者：
//   (a) representative_id == user
//   (b) memberships で representative/officer かつ confirmed
//   (c) organizations.contact_email が user の email と一致
//      （inzaiparque 取込団体の代表者が CiDAO 未登録でも編集できる経路）
export async function canUserEditOrg(
  supabase: SupabaseClient,
  org: OrgForPermission,
  userId: string,
  userEmail: string | null,
): Promise<boolean> {
  if (org.representative_id === userId) return true

  const { data: mem } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', org.id)
    .eq('member_id', userId)
    .eq('status', 'confirmed')
    .in('role', ['representative', 'officer'])
    .is('left_at', null)
    .maybeSingle()
  if (mem) return true

  if (userEmail && org.contact_email && org.contact_email.toLowerCase() === userEmail.toLowerCase()) {
    return true
  }

  return false
}
