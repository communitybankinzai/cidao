import 'server-only'
import { CONSENT_TEXTS, getOrCreateSelfSubject, hasConsent } from '@/lib/consents'
import { createTalentBankClient } from '../db'
import type { Interview } from '../types'

export class InterviewError extends Error {
  constructor(public readonly reason: string) { super(reason) }
}
export async function memberClient(memberId: string) {
  const db = await createTalentBankClient()
  const { data, error } = await db.auth.getUser()
  if (error || data.user?.id !== memberId) throw new InterviewError('unauthorized')
  return db
}
// Keep Phase 1's unique self person intact. A shop/org belongs to that same adult.
export async function registrationSubject(memberId: string) {
  const self = await getOrCreateSelfSubject(memberId)
  const db = await memberClient(memberId)
  const { data, error } = await db.from('talent_subjects').select('*')
    .eq('owner_member_id', memberId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new InterviewError('storage_unavailable')
  return data ?? self
}
export async function hasInterviewConsents(memberId: string, subjectId: string) {
  const results = await Promise.all((['interview', 'external_ai'] as const).map(kind =>
    hasConsent({ memberId, subjectId, kind, version: CONSENT_TEXTS[kind].version }),
  ))
  return results.every(Boolean)
}
export async function assertEligible(memberId: string, subjectId: string) {
  const db = await memberClient(memberId)
  const { data, error } = await db.from('talent_subjects').select('*')
    .eq('id', subjectId).eq('owner_member_id', memberId).maybeSingle()
  if (error) throw new InterviewError('storage_unavailable')
  if (!data?.is_adult_confirmed) throw new InterviewError('eligibility_required')
  if (!await hasInterviewConsents(memberId, subjectId)) throw new InterviewError('consent_required')
}
export function isTurnInFlight(interview: Interview) {
  const state = interview.sufficiency_json
  return !!state && typeof state === 'object' && !Array.isArray(state) &&
    typeof state.in_flight === 'string' && typeof state.lease_until === 'string' &&
    Date.parse(state.lease_until) > Date.now()
}
export async function currentInterview(memberId: string) {
  const db = await memberClient(memberId)
  const { data, error } = await db.from('interviews').select('*').eq('member_id', memberId).eq('kind', 'talent')
    .in('status', ['active', 'paused', 'done']).order('last_activity_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new InterviewError('storage_unavailable')
  return data
}
