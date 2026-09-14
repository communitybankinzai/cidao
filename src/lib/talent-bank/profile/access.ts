import 'server-only'
import { createTalentBankClient } from '../db'
import { memberClient } from '../interview/access'
import { ProfileError } from './validation'

export async function sessionMember() {
  const db = await createTalentBankClient()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) throw new ProfileError('unauthorized')
  return { db, memberId: data.user.id }
}
export async function adminClient(adminId: string) {
  const db = await memberClient(adminId)
  const result = await db.rpc('is_admin')
  if (result.error || !result.data) throw new ProfileError('admin_required')
  return db
}
export async function ownedVersion(memberId: string, versionId: string) {
  const db = await memberClient(memberId)
  const version = await db.from('talent_profile_versions').select('*').eq('id', versionId).maybeSingle()
  if (version.error || !version.data) throw new ProfileError('version_unavailable')
  const profile = await db.from('talent_profiles').select('*').eq('id', version.data.profile_id).eq('member_id', memberId).maybeSingle()
  if (profile.error || !profile.data) throw new ProfileError('unauthorized')
  return { db, version: version.data, profile: profile.data }
}
