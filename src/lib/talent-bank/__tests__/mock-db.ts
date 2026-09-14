import { vi } from 'vitest'

// Each query resolves against a small in-memory table. Track actual filters, not
// just method names, to catch missing consent versions and subject scoping.
export function mockDB(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; operation: string; value: Record<string, unknown> }[] = []
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])]
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query }),
      is: vi.fn((key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query }),
      lte: vi.fn((key: string, value: string) => { rows = rows.filter(row => String(row[key]) <= value); return query }),
      order: vi.fn((key: string, options: { ascending: boolean }) => {
        rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1)); return query
      }),
      limit: vi.fn((count: number) => { rows = rows.slice(0, count); return query }),
      insert: vi.fn((value: Record<string, unknown>) => {
        writes.push({ table, operation: 'insert', value })
        rows = [{ id: 'created', ...value }]; return query
      }),
      update: vi.fn((value: Record<string, unknown>) => { writes.push({ table, operation: 'update', value }); return query }),
      single: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      then: (resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
    }
    return query
  })
  return { from, writes, auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'member-1' } }, error: null })) } }
}
