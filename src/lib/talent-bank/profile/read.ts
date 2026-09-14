import 'server-only'
import { createTalentBankClient } from '../db'
import type { ProfileSearchRow } from '../types'
import { ProfileError } from './validation'

export type ProfileSearch = { q?: string; tag?: string; area?: string }
export function searchConditions({ q = '', tag = '', area = '' }: ProfileSearch) {
  const pattern = (text: string) => {
    const normalized = text.normalize('NFKC').trim().slice(0, 100)
    return normalized ? `%${normalized.replace(/[\\%_]/g, '\\$&')}%` : ''
  }
  return { p_q: pattern(q), p_tag: tag.trim().slice(0, 100), p_area: pattern(area) }
}
export async function searchPublicProfiles(filters: ProfileSearch = {}) {
  const db = await createTalentBankClient()
  const result = await db.rpc('search_talent_profiles', searchConditions(filters))
  if (result.error) throw new ProfileError('storage_unavailable')
  return result.data ?? []
}
// Viewer is the cookie-authenticated DB session. No supplied role can elevate access.
export async function getPublicProfile(identity: { subjectId: string } | { memberId: string }, viewer?: { memberId?: string }) {
  const db = await createTalentBankClient()
  if (viewer?.memberId) {
    const { data, error } = await db.auth.getUser()
    if (error || data.user?.id !== viewer.memberId) throw new ProfileError('unauthorized')
  }
  let query = db.from('talent_profiles').select('*').not('current_version_id', 'is', null)
  query = 'subjectId' in identity ? query.eq('subject_id', identity.subjectId) : query.eq('member_id', identity.memberId)
  const profiles = await query.order('updated_at', { ascending: false }).limit(1)
  if (profiles.error) throw new ProfileError('storage_unavailable')
  const profile = profiles.data?.[0]
  if (!profile?.current_version_id) return null
  const version = await db.from('talent_profile_versions').select('*').eq('id', profile.current_version_id).eq('status', 'published').maybeSingle()
  if (version.error) throw new ProfileError('storage_unavailable')
  if (!version.data) return null
  const links = await db.from('talent_profile_version_tags').select('tag_id').eq('version_id', version.data.id)
  if (links.error) throw new ProfileError('storage_unavailable')
  const ids = (links.data ?? []).map(t => t.tag_id)
  const tags = ids.length ? await db.from('talent_tags').select('*').in('id', ids) : { data: [], error: null }
  if (tags.error) throw new ProfileError('storage_unavailable')
  return { profile, version: version.data, tags: tags.data ?? [] }
}
// Suppress legacy duplicates before applying search, so a nonmatching new profile cannot reveal an old card.
export function withoutPublishedLegacy<T extends { member_id: string }>(legacy: T[], published: Pick<ProfileSearchRow, 'member_id'>[]) {
  const ids = new Set(published.map(p => p.member_id))
  return legacy.filter(p => !ids.has(p.member_id))
}
