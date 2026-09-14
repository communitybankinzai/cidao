import 'server-only'
import { CONSENT_TEXTS, hasConsent } from '@/lib/consents'
import { ownedVersion } from './access'
import { applyFieldPatch, assertComplete, object, ProfileError, scope, shortText } from './validation'

export type DraftPatch = { summary_short?: string; summary_long?: string; fields?: Record<string, { state?: string; value?: string | null }>; tag_ids?: string[]; public_scope?: string }
export async function updateDraft({ memberId, versionId, patch, expectedUpdatedAt, approve = false }: { memberId: string; versionId: string; patch: DraftPatch; expectedUpdatedAt?: string; approve?: boolean }) {
  const { db, version, profile } = await ownedVersion(memberId, versionId)
  if (!['draft', 'owner_reviewed'].includes(version.status)) throw new ProfileError('immutable_version')
  if (profile.draft_version_id !== version.id) throw new ProfileError('stale_version')
  if (Object.keys(object(patch)).some(k => !['summary_short', 'summary_long', 'fields', 'tag_ids', 'public_scope'].includes(k))) throw new ProfileError('invalid_patch')
  const fields = applyFieldPatch(version.fields_json, patch.fields ?? {})
  if (approve) {
    assertComplete(fields)
    if (!await hasConsent({ memberId, subjectId: profile.subject_id, kind: 'profile', version: CONSENT_TEXTS.profile.version })) throw new ProfileError('consent_required')
  }
  const currentTags = await db.from('talent_profile_version_tags').select('tag_id').eq('version_id', versionId)
  if (currentTags.error) throw new ProfileError('storage_unavailable')
  const tagIds = patch.tag_ids ?? (currentTags.data ?? []).map(t => t.tag_id)
  if (!Array.isArray(tagIds) || tagIds.some(t => typeof t !== 'string') || tagIds.length > 100) throw new ProfileError('invalid_tags')
  const saved = await db.rpc('edit_talent_draft', { p_version: versionId, p_expected: expectedUpdatedAt ?? version.updated_at, p_approve: approve,
    p_fields: fields, p_short: shortText(patch.summary_short ?? version.summary_short ?? '', 80),
    p_long: shortText(patch.summary_long ?? version.summary_long ?? '', 400), p_tags: [...new Set(tagIds)], p_scope: scope(patch.public_scope ?? version.public_scope) })
  if (saved.error || !saved.data) throw new ProfileError('save_conflict')
}
export async function ownerApprove({ memberId, versionId }: { memberId: string; versionId: string }) {
  const { db, version, profile } = await ownedVersion(memberId, versionId)
  if (!['draft', 'owner_reviewed'].includes(version.status)) throw new ProfileError('immutable_version')
  if (profile.draft_version_id !== version.id) throw new ProfileError('stale_version')
  assertComplete(version.fields_json)
  if (!await hasConsent({ memberId, subjectId: profile.subject_id, kind: 'profile', version: CONSENT_TEXTS.profile.version })) throw new ProfileError('consent_required')
  const result = await db.rpc('approve_talent_owner', { p_version: versionId, p_expected: version.updated_at })
  if (result.error || !result.data) throw new ProfileError('save_conflict')
}
// A published/retired version is copied before editing; the public version stays immutable.
export async function createRevision({ memberId, versionId }: { memberId: string; versionId: string }) {
  const { db, version, profile } = await ownedVersion(memberId, versionId)
  if (profile.draft_version_id) return profile.draft_version_id
  const tags = await db.from('talent_profile_version_tags').select('tag_id').eq('version_id', versionId)
  if (tags.error) throw new ProfileError('storage_unavailable')
  const result = await db.rpc('save_talent_draft', { p_subject: profile.subject_id, p_fields: version.fields_json,
    p_short: version.summary_short ?? '', p_long: version.summary_long ?? '', p_run: null,
    p_tags: (tags.data ?? []).map(t => t.tag_id), p_suggested: version.suggested_tags, p_scope: version.public_scope })
  if (result.error || !result.data) throw new ProfileError('storage_unavailable')
  return result.data
}
