import { describe, expect, it } from 'vitest'
import {
  buildOrganizerReport,
  findSimilarCandidates,
  organizerGroupsToCsv,
  organizerYmdJst,
  sourceLabel,
  type OrganizerEventRow,
} from '../organizer-groups'

function ev(name: string | null, start: string, src: string | null = null): OrganizerEventRow {
  return { organizer_name_text: name, start_at: start, external_source: src }
}

const events: OrganizerEventRow[] = [
  ev('コスモスパレット', '2026-05-10T01:00:00Z', 'cbi-kouhou-import'),
  ev('コスモスパレット（号外NET の記事より）', '2026-06-10T01:00:00Z', 'goguynet-cosmos'),
  ev('Cosmos Palette', '2026-07-10T01:00:00Z'),
  ev('CosmosPalette', '2026-08-10T01:00:00Z'),
  ev('印西市 教育委員会 生涯学習部文化振興課文化財係', '2026-04-01T01:00:00Z', 'inzai-city-calendar'),
  ev('文化振興課文化振興係', '2026-09-01T01:00:00Z', 'inzai-city-calendar'),
  ev('印西市文化ホール', '2026-10-01T01:00:00Z', 'inzai-bunka-calendar'),
  ev('印西市文化ホール\n（指定管理者：株式会社ケイミックスパブリックビジネス）', '2026-10-05T01:00:00Z', 'inzai-bunka-calendar'),
  ev('印西おやこカフェ ここのわ', '2026-10-06T01:00:00Z'),
  ev('ここのわ', '2026-10-07T01:00:00Z'),
  ev(null, '2026-10-08T01:00:00Z'),
  ev('  ', '2026-10-09T01:00:00Z'),
]

describe('buildOrganizerReport', () => {
  const orgs = [{ id: 'org-1', name: 'NPO法人 コスモスパレット' }]
  const report = buildOrganizerReport(events, [], orgs)

  it('種類数：まとめる前→自動でまとめた後', () => {
    expect(report.rawKinds).toBe(10)
    expect(report.autoKinds).toBe(6)
    expect(report.groupKinds).toBe(6)
    expect(report.unnamedEvents).toBe(2)
    expect(report.totalEvents).toBe(12)
  })

  it('開催回数・初回〜最終・情報元・表記の一覧', () => {
    const cosmos = report.groups.find((g) => g.name === 'コスモスパレット')!
    expect(cosmos.count).toBe(2)
    expect(cosmos.sources.map((s) => s.label).sort()).toEqual(['号外NET', '広報紙'])
    expect(cosmos.variants.map((v) => v.text)).toContain('コスモスパレット（号外NET の記事より）')
    expect(cosmos.org?.id).toBe('org-1')

    const bunka = report.groups.find((g) => g.name === '印西市 文化振興課')!
    expect(bunka.count).toBe(2)
    expect(bunka.first).toBe('2026-04-01T01:00:00Z')
    expect(bunka.last).toBe('2026-09-01T01:00:00Z')

    const hall = report.groups.find((g) => g.name === '印西市文化ホール')!
    expect(hall.count).toBe(2)
  })

  it('開催回数の多い順', () => {
    const counts = report.groups.map((g) => g.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })

  it('名寄せ表でカナと英字をまとめ、表示名はまとめ先の名前になる', () => {
    const r = buildOrganizerReport(
      events,
      [
        { alias_key: 'コスモスパレット', canonical_name: 'コスモスパレット', org_id: null },
        { alias_key: 'cosmospalette', canonical_name: 'コスモスパレット', org_id: null },
      ],
      [],
    )
    expect(r.groupKinds).toBe(5)
    const g = r.groups.find((x) => x.name === 'コスモスパレット')!
    expect(g.count).toBe(4)
    expect(g.merged).toBe(true)
    expect(g.keys).toEqual(['cosmospalette', 'コスモスパレット'].sort())
    expect(g.keyDetails.every((k) => k.aliased)).toBe(true)
  })
})

describe('findSimilarCandidates', () => {
  const report = buildOrganizerReport(events, [], [])
  const cands = findSimilarCandidates(report.groups)
  const has = (x: string, y: string) =>
    cands.some((c) => (c.a.name === x && c.b.name === y) || (c.a.name === y && c.b.name === x))

  it('カナと英字の表記違いを候補にする', () => {
    expect(has('コスモスパレット', 'Cosmos Palette') || has('コスモスパレット', 'CosmosPalette')).toBe(true)
  })

  it('片方がもう片方を含む名前を候補にする（4字以上）', () => {
    expect(has('印西おやこカフェ ここのわ', 'ここのわ')).toBe(true)
  })

  it('同じグループ同士・部署は候補にしない', () => {
    expect(cands.some((c) => c.a.id === c.b.id)).toBe(false)
    expect(cands.some((c) => c.a.name.startsWith('印西市 ') || c.b.name.startsWith('印西市 '))).toBe(false)
  })

  it('名寄せ表でまとめた後は、そのペアは出ない', () => {
    const r = buildOrganizerReport(
      events,
      [
        { alias_key: 'コスモスパレット', canonical_name: 'コスモスパレット', org_id: null },
        { alias_key: 'cosmospalette', canonical_name: 'コスモスパレット', org_id: null },
      ],
      [],
    )
    expect(findSimilarCandidates(r.groups).some((c) => c.a.name === 'コスモスパレット' && c.b.name === 'コスモスパレット')).toBe(false)
  })
})

describe('CSV・補助', () => {
  it('BOM 付き・列・エスケープ', () => {
    const report = buildOrganizerReport([ev('A,"B"', '2026-05-10T15:30:00Z'), ev('=cmd', '2026-05-10T01:00:00Z')], [], [])
    const csv = organizerGroupsToCsv(report.groups)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"A,""B"""')
    expect(csv).toContain("'=cmd")
    // 15:30Z は日本時間で翌日
    expect(csv).toContain('2026-05-11')
    expect(csv.split('\r\n')[0]).toContain('まとめ先')
  })

  it('日付は日本時間', () => {
    expect(organizerYmdJst('2026-05-10T15:30:00Z')).toBe('2026-05-11')
    expect(organizerYmdJst('bad')).toBe('')
  })

  it('情報元の表示名（空はアプリ登録）', () => {
    expect(sourceLabel(null)).toBe('アプリ登録')
    expect(sourceLabel('cbi-kouhou-import')).toBe('広報紙')
    expect(sourceLabel('unknown-src')).toBe('unknown-src')
  })
})
