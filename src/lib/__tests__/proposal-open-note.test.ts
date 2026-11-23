import { describe, expect, it } from 'vitest'
import { countOpenProposals, openProposalsNote } from '@/lib/proposal-open-note'

const NOW = new Date('2026-11-23T09:00:00Z').getTime()
const FUTURE = '2026-12-31T14:59:59Z'
const PAST = '2026-09-30T14:59:59Z'

describe('ホームの提案・投票タイルに出す件数', () => {
  it('投票中だけのときは「投票中 n件」', () => {
    const rows = Array.from({ length: 4 }, () => ({ status: 'voting', voting_end_at: FUTURE }))
    expect(openProposalsNote(rows, NOW)).toBe('投票中 4件')
  })

  it('議論中もあるときは、投票中を先に並べる', () => {
    const rows = [
      { status: 'discussion', voting_end_at: null },
      { status: 'voting', voting_end_at: FUTURE },
      { status: 'discussion', voting_end_at: null },
    ]
    expect(openProposalsNote(rows, NOW)).toBe('投票中 1件・議論中 2件')
  })

  it('議論中だけのときは「議論中 n件」', () => {
    expect(openProposalsNote([{ status: 'discussion', voting_end_at: null }], NOW)).toBe('議論中 1件')
  })

  it('1件も無いときは何も出さない（「0件」と書かない）', () => {
    expect(openProposalsNote([], NOW)).toBeNull()
    expect(openProposalsNote(null, NOW)).toBeNull()
    expect(openProposalsNote(undefined, NOW)).toBeNull()
  })

  it('締め切りを過ぎた投票は、状態が投票中のままでも数えない', () => {
    const rows = [
      { status: 'voting', voting_end_at: PAST },
      { status: 'voting', voting_end_at: FUTURE },
    ]
    expect(countOpenProposals(rows, NOW)).toEqual({ voting: 1, discussion: 0 })
    expect(openProposalsNote([{ status: 'voting', voting_end_at: PAST }], NOW)).toBeNull()
  })

  it('締め切りが入っていない投票は数える。結果が出たもの・下書きは数えない', () => {
    const rows = [
      { status: 'voting', voting_end_at: null },
      { status: 'closed', voting_end_at: PAST },
      { status: 'passed', voting_end_at: PAST },
      { status: 'rejected', voting_end_at: PAST },
      { status: 'draft', voting_end_at: null },
    ]
    expect(countOpenProposals(rows, NOW)).toEqual({ voting: 1, discussion: 0 })
  })
})
