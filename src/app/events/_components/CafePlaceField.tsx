import { CAFE_PLACE_DESC, CAFE_PLACE_LABEL, type CafePlaceInput } from '@/lib/cafe-place'

const inp = 'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm'

// 登録・編集フォームの「コミュニティカフェ」の選択欄（events.cafe_place）。
// ''（自動）のままなら、新規登録は題名・主催名から DB が判定し、編集では今の値を触らない。
// ここで選んだ値は、題名・主催名からの自動判定より優先される。
export function CafePlaceField({
  defaultValue = '',
  autoValue = false,
}: {
  defaultValue?: CafePlaceInput
  // 編集画面で、人が決めていないが自動判定で目印が付いているとき true（案内の文に使う）
  autoValue?: boolean
}) {
  return (
    <div className="space-y-1">
      <label htmlFor="cafe_place" className="text-sm font-medium">{CAFE_PLACE_LABEL}</label>
      <select id="cafe_place" name="cafe_place" defaultValue={defaultValue} className={inp}>
        <option value="">自動（題名・主催名から判定します）</option>
        <option value="yes">{CAFE_PLACE_LABEL}（{CAFE_PLACE_DESC}）</option>
        <option value="none">コミュニティカフェではない</option>
      </select>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        イベントカレンダーの「コミュニティカフェ」の絞り込みに載せるかどうかの目印です。年齢を問わない集まりの場が対象で、「子どもの居場所」「高齢者の居場所」と重ねて選べます。
        {autoValue && defaultValue === '' && <> いまは自動判定で「{CAFE_PLACE_LABEL}」になっています。</>}
      </p>
    </div>
  )
}
