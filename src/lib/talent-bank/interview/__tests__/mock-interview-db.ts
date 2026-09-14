import { vi } from 'vitest'
import type { Interview, InterviewMessage, TalentSubject } from '../../types'

export const memberId = 'member-1'
export const subject: TalentSubject = { id: 'subject-1', owner_member_id: memberId, subject_type: 'person',
  organization_id: null, display_name: '表示名', is_adult_confirmed: true,
  created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }
export function interviewRow(overrides: Partial<Interview> = {}): Interview {
  return { id: 'interview-1', subject_id: subject.id, member_id: memberId, kind: 'talent', status: 'active',
    collected_json: {}, sufficiency_json: null, turn_count: 0,
    started_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...overrides }
}
type Row = Record<string, unknown>
// A test-only DB double that applies filters at execution, persists writes, and
// models the two transactional RPC contracts. It never creates real clients.
export function interviewDB(interviews: Interview[] = [interviewRow()]) {
  const tables: Record<string, Row[]> = { interviews, talent_subjects: [{ ...subject }], interview_messages: [] }
  const writes: { table: string; value: Row }[] = []
  let counter = 0
  let concurrentInsert: Interview | null = null
  let failFinish = false
  const from = vi.fn((table: string) => {
    const filters: ((row: Row) => boolean)[] = []
    let operation = 'select'
    let value: Row = {}
    let order: { key: string; ascending: boolean } | undefined
    let limit = Infinity
    const execute = () => {
      let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
      if (operation === 'insert') {
        if (table === 'interviews' && concurrentInsert) {
          tables.interviews.push(concurrentInsert); concurrentInsert = null
          return { data: null, error: { code: '23505' } }
        }
        if (table === 'interview_messages' && tables[table].some(row => row.interview_id === value.interview_id && row.seq === value.seq)) {
          return { data: null, error: { code: '23505' } }
        }
        const row = table === 'interviews' ? { ...interviewRow(), ...value } : { id: `message-${++counter}`, created_at: new Date().toISOString(), run_id: null, ...value }
        tables[table].push(row); writes.push({ table, value }); rows = [row]
      }
      if (operation === 'update') {
        rows.forEach(row => Object.assign(row, value)); writes.push({ table, value })
      }
      if (order) {
        const { key, ascending } = order
        rows.sort((a, b) => (typeof a[key] === 'number' ? Number(a[key]) - Number(b[key]) : String(a[key]).localeCompare(String(b[key]))) * (ascending ? 1 : -1))
      }
      return { data: structuredClone(rows.slice(0, limit)), error: null }
    }
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => {
        filters.push(row => key.includes('->>') ? (row[key.split('->>')[0]] as Row)?.[key.split('->>')[1]] === value : row[key] === value)
        return query
      }),
      in: vi.fn((key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query }),
      order: vi.fn((key: string, options: { ascending: boolean }) => { order = { key, ...options }; return query }),
      limit: vi.fn((count: number) => { limit = count; return query }),
      insert: vi.fn((input: Row) => { operation = 'insert'; value = input; return query }),
      update: vi.fn((input: Row) => { operation = 'update'; value = input; return query }),
      maybeSingle: vi.fn(async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null } }),
      single: vi.fn(async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null } }),
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return query
  })
  const rpc = vi.fn(async (name: string, args: Row) => {
    const row = tables.interviews.find(row => row.id === args.p_id) as Interview | undefined
    if (!row) return { data: false, error: null }
    if (name === 'claim_interview_turn') {
      if (row.turn_count !== args.p_expected_count || row.status !== 'active') return { data: false, error: null }
      row.turn_count++
      row.sufficiency_json = { in_flight: String(args.p_token), lease_until: new Date(Date.now() + 300_000).toISOString() }
      tables.interview_messages.push({ id: args.p_message_id, interview_id: row.id, seq: row.turn_count * 2 - 1,
        role: 'user', content: args.p_content, run_id: null, created_at: new Date().toISOString() })
    } else {
      if (failFinish) return { data: null, error: { code: 'failed' } }
      if ((row.sufficiency_json as Row).in_flight !== args.p_token) return { data: false, error: null }
      row.collected_json = args.p_collected as Interview['collected_json']
      row.sufficiency_json = args.p_sufficiency as Interview['sufficiency_json']
      row.status = args.p_done ? 'done' : 'active'
      row.completed_at = args.p_done ? new Date().toISOString() : null
      tables.interview_messages.push({ id: `assistant-${++counter}`, interview_id: row.id, seq: row.turn_count * 2,
        role: 'assistant', content: args.p_content, run_id: args.p_run_id, created_at: new Date().toISOString() })
    }
    return { data: true, error: null }
  })
  return { from, rpc, tables, writes,
    messages: () => tables.interview_messages as InterviewMessage[],
    interview: () => tables.interviews[0] as Interview,
    raceInsert: (row: Interview) => { concurrentInsert = row },
    failFinish: () => { failFinish = true },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: memberId } }, error: null })) },
  }
}
