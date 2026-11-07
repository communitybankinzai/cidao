// 子どもの居場所の目印（events.child_place）。
// 付け方の元は DB の関数 public.suggest_child_place（migration 20261108090000）。ここにはその結果の使い方だけを置く。
//   ibasho＝居場所型（子ども食堂・プレーパーク・おやこカフェなど）／oyako＝親子が集まる場（おはなし会・親子講座など）
// events.category（10分類）とは別物。種別は登録フォームの初期値や取り込みの固定値で当てにならなかったため、列を分けた。

export const CHILD_PLACE_KINDS = [
  { key: 'ibasho', label: '居場所型', desc: '子ども食堂・プレーパーク・おやこカフェなど' },
  { key: 'oyako', label: '親子が集まる場', desc: 'おはなし会・親子講座・子育て講座など' },
] as const

export type ChildPlaceKey = (typeof CHILD_PLACE_KINDS)[number]['key']

export function isChildPlaceKey(v: unknown): v is ChildPlaceKey {
  return v === 'ibasho' || v === 'oyako'
}

export function childPlaceLabel(key: string | null | undefined): string {
  return CHILD_PLACE_KINDS.find((k) => k.key === key)?.label ?? ''
}

// ===========================
// URL の ?tag=（絞り込み）
//   kodomo＝居場所型と親子の場の両方／ibasho／oyako
// ===========================
export type ChildPlaceTag = 'kodomo' | ChildPlaceKey

export function parseChildPlaceTag(raw: string | string[] | undefined | null): ChildPlaceTag | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'kodomo' || v === 'ibasho' || v === 'oyako' ? v : null
}

export function tagKinds(tag: ChildPlaceTag): ChildPlaceKey[] {
  return tag === 'kodomo' ? ['ibasho', 'oyako'] : [tag]
}

export function tagLabel(tag: ChildPlaceTag): string {
  return tag === 'kodomo' ? '子どもの居場所' : childPlaceLabel(tag)
}

// ===========================
// 登録・編集フォーム
//   ''    自動（題名・主催名から判定／編集では今の値を触らない）
//   ibasho／oyako  人が決めた
//   none  子ども向けではない（人が決めた）
// ===========================
export type ChildPlaceInput = '' | ChildPlaceKey | 'none'

export function childPlaceColumns(raw: unknown): { child_place?: ChildPlaceKey | null; child_place_checked?: boolean } {
  if (isChildPlaceKey(raw)) return { child_place: raw, child_place_checked: true }
  if (raw === 'none') return { child_place: null, child_place_checked: true }
  return {}
}

export function childPlaceInitialInput(event: { child_place?: string | null; child_place_checked?: boolean | null }): ChildPlaceInput {
  if (!event.child_place_checked) return ''
  return isChildPlaceKey(event.child_place) ? event.child_place : 'none'
}

// ===========================
// 団体名の名寄せ（主催名は自由入力なので、表記ゆれを同じ団体として数える）
// ===========================
const LEGAL_FORM_WORDS = [
  '認定特定非営利活動法人',
  '特定非営利活動法人',
  'npo法人',
  '一般社団法人',
  '公益社団法人',
  '一般財団法人',
  '公益財団法人',
  '社会福祉法人',
  '株式会社',
  '有限会社',
  '合同会社',
  '市民活動団体',
  '任意団体',
  '(株)',
]

export function normalizeOrganizerName(name: string | null | undefined): string {
  const base = (name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  let s = base
  for (const w of LEGAL_FORM_WORDS) s = s.split(w).join('')
  return s || base
}

// ===========================
// 実績サマリー（専用ページ用）。開催回数は「掲載された開催日の数」で、実際に開催された証拠ではない。
// ===========================
export type ChildPlaceEventRow = {
  start_at: string
  child_place: ChildPlaceKey | null
  organizer_name: string | null
  child_place_checked?: boolean | null
  // 開催後に報告された参加者数。null・未指定＝未報告（0人ではなく『不明』）
  attendee_count?: number | null
}

export type ChildPlaceSummary = {
  total: number
  past: number
  upcoming: number
  checked: number
  organizers: number
  // 参加者数：開催日が過ぎた回のうち、人数の報告があった回だけを数える（未報告は含めない）
  attendance: { past: number; reported: number; total: number; average: number | null }
  byKind: Record<ChildPlaceKey, { count: number; past: number; upcoming: number; organizers: number }>
  organizerList: { name: string; count: number }[]
  months: { ym: string; ibasho: number; oyako: number }[]
  firstYm: string | null
  lastYm: string | null
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function ymInJst(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 7)
}

function nextYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function summarizeChildPlace(rows: ChildPlaceEventRow[], nowMs: number): ChildPlaceSummary {
  const kinds: ChildPlaceKey[] = ['ibasho', 'oyako']
  const byKind = {
    ibasho: { count: 0, past: 0, upcoming: 0, organizers: 0 },
    oyako: { count: 0, past: 0, upcoming: 0, organizers: 0 },
  }
  const orgsByKind: Record<ChildPlaceKey, Set<string>> = { ibasho: new Set(), oyako: new Set() }
  const orgAll = new Map<string, { names: Map<string, number>; count: number }>()
  const monthCount = new Map<string, { ibasho: number; oyako: number }>()
  let total = 0
  let past = 0
  let checked = 0
  let reported = 0
  let attendeeTotal = 0

  for (const r of rows) {
    if (!r.child_place || !kinds.includes(r.child_place)) continue
    const ms = new Date(r.start_at).getTime()
    if (Number.isNaN(ms)) continue
    const k = r.child_place
    const isPast = ms < nowMs
    total++
    byKind[k].count++
    if (isPast) {
      past++
      byKind[k].past++
      if (typeof r.attendee_count === 'number' && Number.isFinite(r.attendee_count) && r.attendee_count >= 0) {
        reported++
        attendeeTotal += r.attendee_count
      }
    } else {
      byKind[k].upcoming++
    }
    if (r.child_place_checked) checked++

    const display = (r.organizer_name ?? '').trim() || '（主催者不明）'
    const key = normalizeOrganizerName(display)
    orgsByKind[k].add(key)
    const o = orgAll.get(key) ?? { names: new Map<string, number>(), count: 0 }
    o.count++
    o.names.set(display, (o.names.get(display) ?? 0) + 1)
    orgAll.set(key, o)

    const ym = ymInJst(ms)
    const m = monthCount.get(ym) ?? { ibasho: 0, oyako: 0 }
    m[k]++
    monthCount.set(ym, m)
  }

  byKind.ibasho.organizers = orgsByKind.ibasho.size
  byKind.oyako.organizers = orgsByKind.oyako.size

  const organizerList = [...orgAll.values()]
    .map((o) => ({
      name: [...o.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: o.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const yms = [...monthCount.keys()].sort()
  const firstYm = yms[0] ?? null
  const lastYm = yms[yms.length - 1] ?? null
  const months: ChildPlaceSummary['months'] = []
  if (firstYm && lastYm) {
    for (let ym = firstYm; ym <= lastYm; ym = nextYm(ym)) {
      const m = monthCount.get(ym) ?? { ibasho: 0, oyako: 0 }
      months.push({ ym, ibasho: m.ibasho, oyako: m.oyako })
    }
  }

  return {
    total,
    past,
    upcoming: total - past,
    checked,
    organizers: orgAll.size,
    attendance: {
      past,
      reported,
      total: attendeeTotal,
      average: reported > 0 ? Math.round((attendeeTotal / reported) * 10) / 10 : null,
    },
    byKind,
    organizerList,
    months,
    firstYm,
    lastYm,
  }
}
