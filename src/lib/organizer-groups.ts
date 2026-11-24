// 主催者の開催実績（管理画面 /admin/organizers）の集計。画面と CSV で同じ結果を使うため、DB を触らない純粋な関数にしてある。
// 開催回数は「掲載された開催日の件数」で、実際に開催された証拠ではない。

import { organizerDisplayName, organizerKey, organizerRawLabel, phoneticSkeleton } from '@/lib/organizer-names'

export type OrganizerEventRow = {
  organizer_name_text: string | null
  start_at: string
  external_source: string | null
}

export type OrganizerAliasRow = {
  alias_key: string
  canonical_name: string
  org_id: string | null
}

export type OrganizerOrgRow = { id: string; name: string }

export type OrganizerKeyDetail = {
  key: string
  count: number
  variants: { text: string; count: number }[]
  /** 名寄せ表で動かしてあるキーか（外すボタンを出す） */
  aliased: boolean
}

export type OrganizerGroup = {
  /** 'c:<まとめ先の名前>'（名寄せ表でまとめた）／'k:<自動キー>'（自動のまとまり） */
  id: string
  name: string
  merged: boolean
  keys: string[]
  keyDetails: OrganizerKeyDetail[]
  count: number
  /** 初回・最終の開催日（ISO。日付は表示側で JST に直す） */
  first: string
  last: string
  sources: { label: string; count: number }[]
  /** まとめた表記（重複なし・多い順） */
  variants: { text: string; count: number }[]
  org: { id: string; name: string } | null
}

export type OrganizerReport = {
  groups: OrganizerGroup[]
  totalEvents: number
  /** 主催者名が空で、どの団体にも数えていない件数 */
  unnamedEvents: number
  /** まとめる前の表記の種類数（元の organizer_name_text の種類） */
  rawKinds: number
  /** 自動でまとめた後の種類数（名寄せ表を使う前） */
  autoKinds: number
  /** 名寄せ表も反映した後の種類数（＝groups の数） */
  groupKinds: number
}

// ---------------------------------------------
// 情報元の見せ方
// ---------------------------------------------
const SOURCE_LABELS: Record<string, string> = {
  'cbi-kouhou-import': '広報紙',
  'inzai-city-calendar': '市カレンダー',
  'instagram-hashtag': 'Instagram（タグ）',
  'instagram-account': 'Instagram（アカウント）',
  'cocola-image-scan': 'チラシ画像',
  'inzai-bunka-calendar': '文化ホール',
  'goguynet-cosmos': '号外NET',
}

export function sourceLabel(externalSource: string | null | undefined): string {
  if (!externalSource) return 'アプリ登録'
  return SOURCE_LABELS[externalSource] ?? externalSource
}

// ---------------------------------------------
// 集計
// ---------------------------------------------
type Acc = {
  key: string
  count: number
  first: string
  last: string
  sources: Map<string, number>
  raws: Map<string, number>
  names: Map<string, number>
}

function bump(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by)
}

function sortedCounts(m: Map<string, number>): { text: string; count: number }[] {
  return [...m.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'ja'))
}

/** 同数なら短い名前を先に、それでも同じなら五十音順で、いちばん多い表示名を選ぶ。 */
function pickName(names: Map<string, number>): string {
  const sorted = [...names.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], 'ja'),
  )
  return sorted[0]?.[0] ?? ''
}

export function buildOrganizerReport(
  events: OrganizerEventRow[],
  aliases: OrganizerAliasRow[],
  orgs: OrganizerOrgRow[],
): OrganizerReport {
  const aliasByKey = new Map(aliases.map((a) => [a.alias_key, a]))
  const rawSet = new Set<string>()
  let unnamedEvents = 0

  // 1) 自動キーごとに集計
  const byKey = new Map<string, Acc>()
  for (const e of events) {
    const label = organizerRawLabel(e.organizer_name_text)
    if (!label) {
      unnamedEvents += 1
      continue
    }
    rawSet.add(e.organizer_name_text as string)
    const key = organizerKey(e.organizer_name_text)
    let a = byKey.get(key)
    if (!a) {
      a = { key, count: 0, first: e.start_at, last: e.start_at, sources: new Map(), raws: new Map(), names: new Map() }
      byKey.set(key, a)
    }
    a.count += 1
    if (e.start_at < a.first) a.first = e.start_at
    if (e.start_at > a.last) a.last = e.start_at
    bump(a.sources, sourceLabel(e.external_source))
    bump(a.raws, label)
    bump(a.names, organizerDisplayName(e.organizer_name_text))
  }

  // 2) 名寄せ表でまとめる
  const orgByKey = new Map<string, OrganizerOrgRow>()
  for (const o of orgs) {
    const k = organizerKey(o.name)
    if (k && !orgByKey.has(k)) orgByKey.set(k, o)
  }
  const orgById = new Map(orgs.map((o) => [o.id, o]))

  const grouped = new Map<string, { merged: boolean; name: string; accs: Acc[]; aliasOrgId: string | null }>()
  for (const acc of byKey.values()) {
    const alias = aliasByKey.get(acc.key)
    const id = alias ? `c:${alias.canonical_name}` : `k:${acc.key}`
    let g = grouped.get(id)
    if (!g) {
      g = { merged: !!alias, name: alias ? alias.canonical_name : '', accs: [], aliasOrgId: null }
      grouped.set(id, g)
    }
    g.accs.push(acc)
    if (alias?.org_id && !g.aliasOrgId) g.aliasOrgId = alias.org_id
  }

  const groups: OrganizerGroup[] = []
  for (const [id, g] of grouped) {
    const names = new Map<string, number>()
    const sources = new Map<string, number>()
    const raws = new Map<string, number>()
    let count = 0
    let first = g.accs[0].first
    let last = g.accs[0].last
    for (const a of g.accs) {
      count += a.count
      if (a.first < first) first = a.first
      if (a.last > last) last = a.last
      for (const [k, v] of a.sources) bump(sources, k, v)
      for (const [k, v] of a.raws) bump(raws, k, v)
      for (const [k, v] of a.names) bump(names, k, v)
    }
    const name = g.merged ? g.name : pickName(names)
    const keys = g.accs.map((a) => a.key).sort()
    const org =
      (g.aliasOrgId && orgById.get(g.aliasOrgId)) ||
      keys.map((k) => orgByKey.get(k)).find((o) => !!o) ||
      orgByKey.get(organizerKey(name)) ||
      null
    groups.push({
      id,
      name,
      merged: g.merged,
      keys,
      keyDetails: g.accs
        .map((a) => ({ key: a.key, count: a.count, variants: sortedCounts(a.raws), aliased: aliasByKey.has(a.key) }))
        .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key, 'ja')),
      count,
      first,
      last,
      sources: sortedCounts(sources).map((s) => ({ label: s.text, count: s.count })),
      variants: sortedCounts(raws),
      org: org ? { id: org.id, name: org.name } : null,
    })
  }
  groups.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))

  return {
    groups,
    totalEvents: events.length,
    unnamedEvents,
    rawKinds: rawSet.size,
    autoKinds: byKey.size,
    groupKinds: groups.length,
  }
}

// ---------------------------------------------
// 「似ている候補」：自動キーが別でも、同じ団体かもしれないもの
//   contain … 片方がもう片方を含む（短いほうが4字以上）
//   phonetic … カナと英字などの表記違い（子音の並びが同じ）
// ---------------------------------------------
export type SimilarCandidate = {
  a: OrganizerGroup
  b: OrganizerGroup
  reason: 'contain' | 'phonetic'
}

const CONTAIN_MIN_LENGTH = 4

function isDeptKey(key: string): boolean {
  return key.startsWith('印西市') && key.endsWith('課')
}

function isUnknownKey(key: string): boolean {
  return key.startsWith('主催者不明')
}

export function findSimilarCandidates(groups: OrganizerGroup[], limit = 150): SimilarCandidate[] {
  const out: SimilarCandidate[] = []
  const seen = new Set<string>()
  const push = (a: OrganizerGroup, b: OrganizerGroup, reason: SimilarCandidate['reason']) => {
    const id = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({ a, b, reason })
  }

  // 比べる対象：部署と「主催者不明」は除く。各グループは「自動キー」の集まりなので、キー同士で比べる
  type Item = { g: OrganizerGroup; key: string; skel: string | null }
  const items: Item[] = []
  for (const g of groups) {
    for (const key of g.keys) {
      if (isDeptKey(key) || isUnknownKey(key)) continue
      items.push({ g, key, skel: phoneticSkeleton(key) })
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i]
      const y = items[j]
      if (x.g.id === y.g.id) continue
      const [short, long] = x.key.length <= y.key.length ? [x.key, y.key] : [y.key, x.key]
      if (short.length >= CONTAIN_MIN_LENGTH && long.includes(short)) {
        push(x.g, y.g, 'contain')
      } else if (x.skel && y.skel && x.skel === y.skel) {
        push(x.g, y.g, 'phonetic')
      }
    }
  }

  out.sort((p, q) => q.a.count + q.b.count - (p.a.count + p.b.count))
  return out.slice(0, limit)
}

// ---------------------------------------------
// CSV（Excel で文字化けしないよう、先頭に BOM を付ける）
// ---------------------------------------------
export function organizerYmdJst(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
}

function csvCell(v: string | number): string {
  let s = String(v)
  // Excel で式として解釈されないようにする
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function organizerGroupsToCsv(groups: OrganizerGroup[]): string {
  const header = ['まとめ先', '開催回数(掲載された開催日の数)', '初回の開催日', '最終の開催日', '情報元の内訳', 'まとめた表記', '登録団体']
  const lines = [header.map(csvCell).join(',')]
  for (const g of groups) {
    lines.push(
      [
        g.name,
        g.count,
        organizerYmdJst(g.first),
        organizerYmdJst(g.last),
        g.sources.map((s) => `${s.label}${s.count}`).join(' / '),
        g.variants.map((v) => (v.count > 1 ? `${v.text}(${v.count})` : v.text)).join(' / '),
        g.org?.name ?? '',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
