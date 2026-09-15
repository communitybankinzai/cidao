import { expect, it } from 'vitest'
import { getFootprints, hasFootprints } from '../footprints'

type Result = { data?: unknown; error?: unknown; count?: number }
// 呼ばれた絞り込みを記録し、表ごとに決めた結果を返すだけの簡単な偽物
function fakeDb(results: Record<string, Result>) {
  const calls: Record<string, [string, ...unknown[]][]> = {}
  const db = {
    from(table: string) {
      const log: [string, ...unknown[]][] = (calls[table] = [])
      const result = { data: null, error: null, ...results[table] }
      const chain: Record<string, unknown> = {
        then: (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: () => Promise.resolve(result),
      }
      for (const m of ['select', 'eq', 'neq', 'is', 'order', 'limit']) chain[m] = (...args: unknown[]) => { log.push([m, ...args]); return chain }
      return chain
    },
  }
  return { db: db as never, calls }
}

const visible = { members: { data: { show_footprints: true } } }

it('returns null when the member hides footprints or the setting cannot be read', async () => {
  expect(await getFootprints(fakeDb({ members: { data: { show_footprints: false } } }).db, 'm1')).toBeNull()
  expect(await getFootprints(fakeDb({ members: { data: null } }).db, 'm1')).toBeNull()
  expect(await getFootprints(fakeDb({ members: { error: { message: 'column does not exist' } } }).db, 'm1')).toBeNull()
})

it('collects only already-public records and maps them', async () => {
  const { db, calls } = fakeDb({
    ...visible,
    memberships: { data: [
      { role: 'representative', organizations: { id: 'o1', name: '印西の会' } },
      { role: 'member', organizations: [{ id: 'o2', name: '里山クラブ' }] },
      { role: 'member', organizations: null }, // 見る人に団体が見えないときは出さない
    ] },
    proposals: { data: [{ id: 'p1', title: '防災マップをつくろう' }] },
    comments: { count: 4 },
    events: { data: [{ id: 'e1', title: '革小物ワークショップ', start_at: '2026-10-01T01:00:00Z' }] },
  })
  const f = await getFootprints(db, 'm1')
  expect(f).toEqual({
    orgs: [{ id: 'o1', name: '印西の会', representative: true }, { id: 'o2', name: '里山クラブ', representative: false }],
    proposals: [{ id: 'p1', title: '防災マップをつくろう' }],
    commentCount: 4,
    events: [{ id: 'e1', title: '革小物ワークショップ', startAt: '2026-10-01T01:00:00Z' }],
  })
  expect(hasFootprints(f!)).toBe(true)
  // 所属は本人が団体ページに載せると選んだものだけ、主催は代理登録・自動収集を除く
  expect(calls.memberships).toContainEqual(['eq', 'display_in_org', true])
  expect(calls.memberships).toContainEqual(['is', 'left_at', null])
  expect(calls.proposals).toContainEqual(['neq', 'status', 'draft'])
  expect(calls.events).toContainEqual(['eq', 'proxy_registration', false])
  expect(calls.events).toContainEqual(['is', 'external_source', null])
  // 投票・参加・ポイント・相談の表は読まない
  for (const t of ['votes', 'event_participants', 'contributions', 'talent_inquiries']) expect(calls[t]).toBeUndefined()
})

it('drops only the item whose query fails', async () => {
  const f = await getFootprints(fakeDb({
    ...visible,
    memberships: { error: { message: 'down' } },
    proposals: { data: [{ id: 'p1', title: '提案' }] },
    comments: { error: { message: 'down' } },
    events: { data: [] },
  }).db, 'm1')
  expect(f).toEqual({ orgs: [], proposals: [{ id: 'p1', title: '提案' }], commentCount: 0, events: [] })
})

it('reports nothing to show when every list is empty', async () => {
  const f = await getFootprints(fakeDb({ ...visible, memberships: { data: [] }, proposals: { data: [] }, comments: { count: 0 }, events: { data: [] } }).db, 'm1')
  expect(hasFootprints(f!)).toBe(false)
})
