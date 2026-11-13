import { SENIOR_PLACE_DESC, SENIOR_PLACE_LABEL, type SeniorPlaceInput } from '@/lib/senior-place'

const inp = 'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm'

// 登録・編集フォームの「高齢者の居場所」の選択欄（events.senior_place）。
// ''（自動）のままなら、新規登録は題名・主催名から DB が判定し、編集では今の値を触らない。
// ここで選んだ値は、題名・主催名からの自動判定より優先される。
export function SeniorPlaceField({
  defaultValue = '',
  autoValue = false,
}: {
  defaultValue?: SeniorPlaceInput
  // 編集画面で、人が決めていないが自動判定で目印が付いているとき true（案内の文に使う）
  autoValue?: boolean
}) {
  return (
    <div className="space-y-1">
      <label htmlFor="senior_place" className="text-sm font-medium">{SENIOR_PLACE_LABEL}</label>
      <select id="senior_place" name="senior_place" defaultValue={defaultValue} className={inp}>
        <option value="">自動（題名・主催名から判定します）</option>
        <option value="yes">{SENIOR_PLACE_LABEL}（{SENIOR_PLACE_DESC}）</option>
        <option value="none">高齢者向けではない</option>
      </select>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        イベントカレンダーの「高齢者の居場所」の絞り込みに載せるかどうかの目印です。子どもと高齢者の両方が集まる場は、上の「子どもの居場所」と両方を選べます。
        {autoValue && defaultValue === '' && <> いまは自動判定で「{SENIOR_PLACE_LABEL}」になっています。</>}
      </p>
    </div>
  )
}
