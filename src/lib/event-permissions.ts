import type { SupabaseClient } from '@supabase/supabase-js'

type EventForPermission = {
  organizer_type: 'member' | 'org'
  organizer_id: string
  organizer_name_text: string | null
  proxy_registration: boolean
}

// /events/[id] と /events/[id]/edit 双方で「編集できるか」を server で判定するためのヘルパー。
// 実際の UPDATE/DELETE は RLS (can_edit_event) で防がれるが、UI 出し分けのため事前判定する。
export async function canUserEditEvent(
  supabase: SupabaseClient,
  event: EventForPermission,
  userId: string,
  userEmail: string | null,
): Promise<boolean> {
  if (event.organizer_type === 'member' && event.organizer_id === userId) return true

  if (event.organizer_type === 'org') {
    const { data: mem } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', event.organizer_id)
      .eq('member_id', userId)
      .eq('status', 'confirmed')
      .in('role', ['representative', 'officer'])
      .is('left_at', null)
      .maybeSingle()
    if (mem) return true

    if (userEmail) {
      const { data: o } = await supabase
        .from('organizations')
        .select('contact_email')
        .eq('id', event.organizer_id)
        .maybeSingle()
      if (o?.contact_email && o.contact_email.toLowerCase() === userEmail.toLowerCase()) {
        return true
      }
    }
  }

  if (event.proxy_registration && event.organizer_name_text) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, contact_email')
      .eq('name', event.organizer_name_text)
    for (const o of orgs ?? []) {
      if (userEmail && o.contact_email && o.contact_email.toLowerCase() === userEmail.toLowerCase()) {
        return true
      }
      const { data: mem } = await supabase
        .from('memberships')
        .select('role')
        .eq('org_id', o.id)
        .eq('member_id', userId)
        .eq('status', 'confirmed')
        .in('role', ['representative', 'officer'])
        .is('left_at', null)
        .maybeSingle()
      if (mem) return true
    }
  }

  return false
}
