// 高齢者の居場所の目印（events.senior_place）。
// 付け方の元は DB の関数 public.suggest_senior_place（migration 20261114100000）。ここにはその結果の使い方だけを置く。
// 子どもの居場所（events.child_place・src/lib/child-place.ts）とは別の列。
// コミュニティカフェや地域食堂のように両方が集まる催しには、両方の目印が付く。

import { parseChildPlaceTag, tagLabel, type ChildPlaceTag } from './child-place'

export const SENIOR_PLACE_LABEL = '高齢者の居場所'
export const SENIOR_PLACE_DESC = 'オレンジカフェ・コミュニティカフェ・サロン・介護予防教室など'

// ===========================
// URL の ?tag=（絞り込み）
//   kodomo／ibasho／oyako＝子どもの居場所（child-place.ts）、senior＝高齢者の居場所
// ===========================
export type PlaceTag = ChildPlaceTag | 'senior'

export function parsePlaceTag(raw: string | string[] | undefined | null): PlaceTag | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'senior' ? 'senior' : parseChildPlaceTag(raw)
}

export function placeTagLabel(tag: PlaceTag): string {
  return tag === 'senior' ? SENIOR_PLACE_LABEL : tagLabel(tag)
}

// ===========================
// 登録・編集フォーム
//   ''    自動（題名・主催名から判定／編集では今の値を触らない）
//   yes   高齢者の居場所（人が決めた）
//   none  対象ではない（人が決めた）
// ===========================
export type SeniorPlaceInput = '' | 'yes' | 'none'

export function seniorPlaceColumns(raw: unknown): { senior_place?: boolean; senior_place_checked?: boolean } {
  if (raw === 'yes') return { senior_place: true, senior_place_checked: true }
  if (raw === 'none') return { senior_place: false, senior_place_checked: true }
  return {}
}

export function seniorPlaceInitialInput(event: { senior_place?: boolean | null; senior_place_checked?: boolean | null }): SeniorPlaceInput {
  if (!event.senior_place_checked) return ''
  return event.senior_place ? 'yes' : 'none'
}
