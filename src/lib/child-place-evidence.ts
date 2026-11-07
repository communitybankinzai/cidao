// 「こどもの居場所カレンダー」の根拠の一覧（1件ずつの日付・催し・主催・人数・出典）と、その CSV。
// 実績の数字（開催回数・団体数・参加者数）が何から数えられたかを、1件ずつ確かめられるようにするためのもの。
import { childPlaceLabel, type ChildPlaceKey } from './child-place'

// 画面から取ってくる1件ぶん（events の列）
export type ChildPlaceRecord = {
  id: string
  title: string
  start_at: string
  location: string | null
  child_place: ChildPlaceKey
  child_place_checked: boolean
  organizer_type: 'member' | 'org'
  organizer_id: string
  organizer_name_text: string | null
  proxy_source_url: string | null
  website_url: string | null
  external_source: string | null
  attendee_count: number | null
  attendee_count_source: 'organizer' | 'operator' | null
}

export type EvidenceRow = {
  id: string
  date: string // YYYY-MM-DD（日本時間）
  time: string // HH:mm（日本時間）
  title: string
  organizer: string
  kind: ChildPlaceKey
  kindLabel: string
  location: string
  held: boolean // 開催日（開始時刻）が過ぎている
  attendee: number | null // null＝未報告（0人ではなく不明）
  attendeeSource: '主催者' | '運営' | ''
  sourceKind: string // どこから CiDAO に載ったか
  sourceUrl: string // 出典のURL（なければ空）
  pagePath: string // CiDAO のイベントページ（/events/<id>）
  checked: boolean // 目印を人が確認したか
}

// 登録フォームから代理登録したときに入る、出典ではない固定のURL
const FORM_PLACEHOLDER_URL = 'https://cidao.vercel.app/events/new'

const SOURCE_KIND_LABEL: Record<string, string> = {
  'inzai-city-calendar': '印西市のカレンダー',
  'inzai-bunka-calendar': '印西市文化ホールのカレンダー',
  'cbi-kouhou-import': '広報いんざい',
  'cocola-image-scan': 'チラシ（画像の読み取り）',
  'instagram-account': 'Instagram',
  'instagram-hashtag': 'Instagram',
  'goguynet-cosmos': 'goguynet',
}

export function sourceKindLabel(externalSource: string | null | undefined): string {
  if (!externalSource) return 'CiDAO への登録'
  return SOURCE_KIND_LABEL[externalSource] ?? externalSource
}

export function sourceUrlOf(rec: Pick<ChildPlaceRecord, 'proxy_source_url' | 'website_url'>): string {
  const p = (rec.proxy_source_url ?? '').trim()
  if (/^https?:\/\//i.test(p) && p !== FORM_PLACEHOLDER_URL) return p
  const w = (rec.website_url ?? '').trim()
  return /^https?:\/\//i.test(w) ? w : ''
}

// 主催の表示名。個人の名前（会員の表示名）は出さない
export function organizerDisplayName(
  rec: Pick<ChildPlaceRecord, 'organizer_type' | 'organizer_id' | 'organizer_name_text'>,
  orgNames: Record<string, string>,
): string {
  if (rec.organizer_type === 'org') return orgNames[rec.organizer_id] ?? rec.organizer_name_text ?? '（団体名不明）'
  return (rec.organizer_name_text ?? '').trim() || '個人主催（名前は非公開）'
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export function buildEvidenceRows(records: ChildPlaceRecord[], orgNames: Record<string, string>, nowMs: number): EvidenceRow[] {
  const rows: EvidenceRow[] = []
  for (const r of records) {
    const ms = new Date(r.start_at).getTime()
    if (Number.isNaN(ms)) continue
    const jst = new Date(ms + JST_OFFSET_MS).toISOString() // 2026-09-20T10:00:00.000Z（日本時間の値）
    const held = ms < nowMs
    const reported = held && typeof r.attendee_count === 'number' && r.attendee_count >= 0
    rows.push({
      id: r.id,
      date: jst.slice(0, 10),
      time: jst.slice(11, 16),
      title: r.title,
      organizer: organizerDisplayName(r, orgNames),
      kind: r.child_place,
      kindLabel: childPlaceLabel(r.child_place),
      location: (r.location ?? '').trim(),
      held,
      attendee: reported ? (r.attendee_count as number) : null,
      attendeeSource: reported ? (r.attendee_count_source === 'operator' ? '運営' : r.attendee_count_source === 'organizer' ? '主催者' : '') : '',
      sourceKind: sourceKindLabel(r.external_source),
      sourceUrl: sourceUrlOf(r),
      pagePath: `/events/${r.id}`,
      checked: r.child_place_checked,
    })
  }
  // 日付の古い順（同じ日は開始時刻・題名の順）
  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.title.localeCompare(b.title, 'ja'))
  return rows
}

// ===========================
// CSV（Excel で開けるよう UTF-8 の BOM つき・改行は CRLF）
// ===========================
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v)
  // 表計算ソフトで式として実行されないよう、先頭が = + - @ タブ 改行 のものには ' を付ける
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const EVIDENCE_CSV_HEADER = [
  '開催日',
  '開始時刻',
  '催し',
  '主催',
  '目印',
  '場所',
  '開催日が過ぎたか',
  '参加者数',
  '参加者数の報告者',
  '出典の種類',
  '出典URL',
  'CiDAOのページ',
  '目印の人の確認',
]

export function evidenceToCsv(rows: EvidenceRow[], origin: string): string {
  const lines = [EVIDENCE_CSV_HEADER.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.time,
        r.title,
        r.organizer,
        r.kindLabel,
        r.location,
        r.held ? '過ぎた' : 'これから',
        r.attendee,
        r.attendeeSource,
        r.sourceKind,
        r.sourceUrl,
        `${origin}${r.pagePath}`,
        r.checked ? '済' : '自動判定のまま',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
