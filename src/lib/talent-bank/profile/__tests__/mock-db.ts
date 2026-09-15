import { vi } from 'vitest'
import { INTERVIEW_FIELDS } from '../../interview/fields'
import type { ProfileFields, ProfileVersion, TalentProfile, TalentTag } from '../../types'
export const memberId = 'member-1'
export const fields = (): ProfileFields => Object.fromEntries(INTERVIEW_FIELDS.map(f => [f.field_key, {
  state: 'answered', value: `${f.label}の回答`, evidence: ['11111111-1111-4111-8111-111111111111'], source: 'interview',
}]))
export const profile = (): TalentProfile => ({ id: 'profile-1', subject_id: 'subject-1', member_id: memberId,
  current_version_id: null, draft_version_id: 'version-1', public_scope: 'private', face_mode: 'photo', created_at: 'now', updated_at: 'now' })
export const version = (patch: Partial<ProfileVersion> = {}): ProfileVersion => ({ id: 'version-1', profile_id: 'profile-1', version: 1,
  status: 'draft', fields_json: fields(), summary_short: '短い紹介', summary_long: '詳しい紹介', generated_run_id: 'run-1',
  edited_by_owner_at: null, owner_approved_at: null, admin_approved_by: null, admin_approved_at: null, rejected_reason: null,
  public_scope: 'private', suggested_tags: [], created_at: 'now', updated_at: 'now', ...patch })
export const tag: TalentTag = { id: 'tag-1', slug: 'leathercraft', label: 'レザークラフト', kind: 'skill', created_at: 'now' }
type Row = Record<string, unknown>
// Contract double, not a PostgreSQL/RLS implementation. Real transports fail in the global setup.
export function profileDB() {
  const tables: Record<string, Row[]> = {
    interviews: [{ id: 'interview-1', subject_id: 'subject-1', member_id: memberId, kind: 'talent', status: 'done', collected_json: fields() }],
    interview_messages: [{ id: '11111111-1111-4111-8111-111111111111', interview_id: 'interview-1', role: 'user', content: '私の回答' }],
    talent_tags: [tag], talent_profiles: [profile()], talent_profile_versions: [version()],
    talent_profile_version_tags: [], publications: [], work_logs: [],
  }
  let fail = false
  let admin = true
  const from = vi.fn((table: string) => {
    const filters: ((row: Row) => boolean)[] = []
    let limit = Infinity
    let orderKey = ''
    let ascending = true
    const result = () => {
      let rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
      if (orderKey) rows = [...rows].sort((a, b) => String(a[orderKey]).localeCompare(String(b[orderKey])) * (ascending ? 1 : -1))
      return { data: structuredClone(rows.slice(0, limit)), error: null }
    }
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((k: string, v: unknown) => { filters.push(r => r[k] === v); return query }),
      in: vi.fn((k: string, vs: unknown[]) => { filters.push(r => vs.includes(r[k])); return query }),
      not: vi.fn((k: string, _op: string, v: unknown) => { filters.push(r => r[k] !== v); return query }),
      order: vi.fn((k: string, options?: { ascending?: boolean }) => { orderKey = k; ascending = options?.ascending ?? true; return query }),
      limit: vi.fn((n: number) => { limit = n; return query }),
      maybeSingle: vi.fn(async () => ({ ...result(), data: result().data[0] ?? null })),
      single: vi.fn(async () => ({ ...result(), data: result().data[0] ?? null })),
      then: (resolve: (v: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return query
  })
  const rpc = vi.fn(async (name: string, a: Row = {}) => {
    if (name === 'is_admin') return { data: admin, error: null }
    if (fail) return { data: null, error: { code: 'failed' } }
    if (name === 'search_talent_profiles') return { data: [], error: null }
    const p = tables.talent_profiles[0] as TalentProfile
    const v = tables.talent_profile_versions.find(v => v.id === a.p_version) as ProfileVersion | undefined
    if (name === 'save_talent_draft') {
      const n = Math.max(0, ...tables.talent_profile_versions.map(v => Number(v.version))) + 1
      const row = version({ id: `version-${n}`, version: n, fields_json: a.p_fields as ProfileFields,
        summary_short: String(a.p_short), summary_long: String(a.p_long), generated_run_id: a.p_run as string | null,
        public_scope: a.p_scope as ProfileVersion['public_scope'], suggested_tags: a.p_suggested as string[] })
      tables.talent_profile_versions.push(row); p.draft_version_id = row.id
      tables.talent_profile_version_tags.push(...(a.p_tags as string[]).map(id => ({ version_id: row.id, tag_id: id, source: 'ai' })))
      return { data: row.id, error: null }
    }
    if (name === 'unpublish_talent_profile') {
      if (p.id !== a.p_profile || (a.p_actor !== memberId && !admin)) return { data: null, error: {} }
      const current = tables.talent_profile_versions.find(v => v.id === p.current_version_id)
      if (current) current.status = 'retired'
      p.current_version_id = null
      tables.publications.forEach(r => { r.unpublished_at = 'later' })
      return { data: p.member_id, error: null }
    }
    if (!v || p.draft_version_id !== v.id) return { data: false, error: null }
    if (name === 'edit_talent_draft') {
      if (a.p_expected !== v.updated_at || !['draft', 'owner_reviewed'].includes(v.status)) return { data: false, error: null }
      Object.assign(v, { fields_json: a.p_fields, summary_short: a.p_short, summary_long: a.p_long,
        public_scope: a.p_scope, edited_by_owner_at: 'later', status: 'draft', owner_approved_at: null })
    } else if (name === 'approve_talent_owner') {
      v.status = 'owner_reviewed'; v.owner_approved_at = 'later'
    } else if (name === 'publish_talent_version') {
      if (v.status !== 'owner_reviewed') return { data: null, error: {} }
      const old = tables.talent_profile_versions.find(v => v.id === p.current_version_id)
      if (old) old.status = 'retired'
      v.status = 'published'; p.current_version_id = v.id; p.draft_version_id = null; p.public_scope = v.public_scope
      tables.publications.push({ version_id: v.id, profile_id: p.id, scope: v.public_scope, unpublished_at: null })
      tables.work_logs.push({ kind: 'profile_review', minutes: a.p_minutes, edit_count: a.p_edits })
      return { data: p.member_id, error: null }
    } else if (name === 'reject_talent_version') {
      v.status = 'draft'; v.owner_approved_at = null; v.rejected_reason = String(a.p_reason)
      return { data: p.member_id, error: null }
    }
    return { data: true, error: null }
  })
  return { tables, from, rpc, fail: () => { fail = true }, denyAdmin: () => { admin = false },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: memberId } }, error: null })) } }
}
