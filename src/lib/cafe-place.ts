// コミュニティカフェの目印（events.cafe_place）。
// 付け方の元は DB の関数 public.suggest_cafe_place（migration 20261114110000）。ここにはその結果の使い方だけを置く。
// コミュニティカフェ＝地域の「たまり場」「居場所」になっている場の総称で、年齢では区切らない。
// 子どもの居場所（child_place）・高齢者の居場所（senior_place）とは別の列なので、重ねて付く（おやこカフェ＝子ども＋カフェ）。

export const CAFE_PLACE_LABEL = 'コミュニティカフェ'
export const CAFE_PLACE_DESC = 'だれでも立ち寄れる集まりの場（カフェ・サロン・地域食堂・茶話会など）'

// 登録・編集フォーム：''＝自動（編集では今の値を触らない）／yes＝コミュニティカフェ／none＝ちがう（どちらも人が決めた）
export type CafePlaceInput = '' | 'yes' | 'none'

export function cafePlaceColumns(raw: unknown): { cafe_place?: boolean; cafe_place_checked?: boolean } {
  if (raw === 'yes') return { cafe_place: true, cafe_place_checked: true }
  if (raw === 'none') return { cafe_place: false, cafe_place_checked: true }
  return {}
}

export function cafePlaceInitialInput(event: { cafe_place?: boolean | null; cafe_place_checked?: boolean | null }): CafePlaceInput {
  if (!event.cafe_place_checked) return ''
  return event.cafe_place ? 'yes' : 'none'
}
