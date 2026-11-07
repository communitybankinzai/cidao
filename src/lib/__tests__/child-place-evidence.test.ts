import { describe, expect, it } from 'vitest'
import {
  buildEvidenceRows,
  csvCell,
  evidenceToCsv,
  organizerDisplayName,
  sourceKindLabel,
  sourceUrlOf,
  type ChildPlaceRecord,
} from '../child-place-evidence'

const NOW = new Date('2026-11-08T03:00:00Z').getTime() // 2026-11-08 12:00 JST

const rec = (over: Partial<ChildPlaceRecord> = {}): ChildPlaceRecord => ({
  id: 'e1',
  title: 'ちいき食堂 てとてリビング',
  start_at: '2026-09-20T02:00:00Z', // 11:00 JST
  location: '印西市大森2357-6',
  child_place: 'ibasho',
  child_place_checked: true,
  organizer_type: 'member',
  organizer_id: 'm1',
  organizer_name_text: 'NPO法人 Shake Hands Japan',
  proxy_source_url: 'https://example.org/post/1',
  website_url: null,
  external_source: null,
  attendee_count: 12,
  attendee_count_source: 'organizer',
  ...over,
})

describe('出典', () => {
  it('代理登録の出典URLを使う。登録フォームの固定URLは出典ではないので使わない', () => {
    expect(sourceUrlOf({ proxy_source_url: 'https://example.org/a', website_url: null })).toBe('https://example.org/a')
    expect(sourceUrlOf({ proxy_source_url: 'https://cidao.vercel.app/events/new', website_url: null })).toBe('')
    expect(sourceUrlOf({ proxy_source_url: 'https://cidao.vercel.app/events/new', website_url: 'https://site.example/' })).toBe('https://site.example/')
  })

  it('http(s) 以外は出さない', () => {
    expect(sourceUrlOf({ proxy_source_url: 'javascript:alert(1)', website_url: 'ftp://x' })).toBe('')
    expect(sourceUrlOf({ proxy_source_url: null, website_url: null })).toBe('')
  })

  it('取り込み元の日本語名（知らないものはそのまま、なければ CiDAO への登録）', () => {
    expect(sourceKindLabel('inzai-city-calendar')).toBe('印西市のカレンダー')
    expect(sourceKindLabel('cbi-kouhou-import')).toBe('広報いんざい')
    expect(sourceKindLabel('something-new')).toBe('something-new')
    expect(sourceKindLabel(null)).toBe('CiDAO への登録')
  })
})

describe('主催の表示名', () => {
  it('団体名義は団体名、代理登録は入力された名前', () => {
    expect(organizerDisplayName({ organizer_type: 'org', organizer_id: 'o1', organizer_name_text: null }, { o1: 'みんなのおにわ' })).toBe('みんなのおにわ')
    expect(organizerDisplayName({ organizer_type: 'member', organizer_id: 'm1', organizer_name_text: 'ここのわ' }, {})).toBe('ここのわ')
  })

  it('名前のない個人主催は、会員の表示名を出さず「名前は非公開」にする', () => {
    expect(organizerDisplayName({ organizer_type: 'member', organizer_id: 'm1', organizer_name_text: null }, {})).toBe('個人主催（名前は非公開）')
    expect(organizerDisplayName({ organizer_type: 'member', organizer_id: 'm1', organizer_name_text: '  ' }, {})).toBe('個人主催（名前は非公開）')
  })
})

describe('根拠の行', () => {
  it('日本時間の日付・時刻、過ぎたか、人数と報告者', () => {
    const [r] = buildEvidenceRows([rec()], {}, NOW)
    expect(r).toMatchObject({
      date: '2026-09-20', time: '11:00', held: true, attendee: 12, attendeeSource: '主催者',
      kindLabel: '居場所型', sourceKind: 'CiDAO への登録', sourceUrl: 'https://example.org/post/1', pagePath: '/events/e1', checked: true,
    })
  })

  it('運営が入れた人数は「運営」', () => {
    expect(buildEvidenceRows([rec({ attendee_count_source: 'operator' })], {}, NOW)[0].attendeeSource).toBe('運営')
  })

  it('未報告は null（0にしない）。これから開かれる回の人数は出さない', () => {
    expect(buildEvidenceRows([rec({ attendee_count: null, attendee_count_source: null })], {}, NOW)[0].attendee).toBeNull()
    const future = buildEvidenceRows([rec({ start_at: '2026-12-01T02:00:00Z', attendee_count: 30 })], {}, NOW)[0]
    expect(future.held).toBe(false)
    expect(future.attendee).toBeNull()
  })

  it('0人と報告された回は 0（未報告とは別）', () => {
    expect(buildEvidenceRows([rec({ attendee_count: 0 })], {}, NOW)[0].attendee).toBe(0)
  })

  it('日付の古い順に並べ、壊れた日時は飛ばす', () => {
    const rows = buildEvidenceRows(
      [rec({ id: 'b', start_at: '2026-10-01T02:00:00Z' }), rec({ id: 'a', start_at: '2026-09-01T02:00:00Z' }), rec({ id: 'x', start_at: 'broken' })],
      {},
      NOW,
    )
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('日本時間で日をまたぐ開始時刻は日本時間の日付', () => {
    // 2026-08-31 16:00 UTC = 2026-09-01 01:00 JST
    expect(buildEvidenceRows([rec({ start_at: '2026-08-31T16:00:00Z' })], {}, NOW)[0]).toMatchObject({ date: '2026-09-01', time: '01:00' })
  })
})

describe('CSV', () => {
  it('カンマ・引用符・改行を含む値は引用符で囲む', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('1\n2')).toBe('"1\n2"')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12)).toBe('12')
  })

  it('式として実行されうる先頭文字には引用符を付けて無害化する', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@cmd')).toBe("'@cmd")
  })

  it('BOM つき・CRLF・見出し行と1件ぶんの行・人数は未報告なら空', () => {
    const rows = buildEvidenceRows([rec(), rec({ id: 'e2', start_at: '2026-09-27T02:00:00Z', attendee_count: null, attendee_count_source: null })], {}, NOW)
    const csv = evidenceToCsv(rows, 'https://cidao.vercel.app')
    expect(csv.startsWith('﻿開催日,開始時刻,催し,')).toBe(true)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('2026-09-20,11:00,ちいき食堂 てとてリビング,NPO法人 Shake Hands Japan,居場所型,印西市大森2357-6,過ぎた,12,主催者,')
    expect(lines[1]).toContain('https://cidao.vercel.app/events/e1')
    expect(lines[2]).toContain(',過ぎた,,,')
  })
})
