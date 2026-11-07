import { CHILD_PLACE_KINDS, childPlaceLabel, type ChildPlaceInput } from '@/lib/child-place'

const inp = 'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm'

// 登録・編集フォームの「子どもの居場所」の選択欄（events.child_place）。
// ''（自動）のままなら、新規登録は題名・主催名から DB が判定し、編集では今の値を触らない。
export function ChildPlaceField({
  defaultValue = '',
  autoValue,
}: {
  defaultValue?: ChildPlaceInput
  // 編集画面で、人が決めていないが自動判定で目印が付いているときの値（案内の文に使う）
  autoValue?: string | null
}) {
  const autoLabel = childPlaceLabel(autoValue)
  return (
    <div className="space-y-1">
      <label htmlFor="child_place" className="text-sm font-medium">子どもの居場所</label>
      <select id="child_place" name="child_place" defaultValue={defaultValue} className={inp}>
        <option value="">自動（題名・主催名から判定します）</option>
        {CHILD_PLACE_KINDS.map((k) => (
          <option key={k.key} value={k.key}>{k.label}（{k.desc}）</option>
        ))}
        <option value="none">子ども向けではない</option>
      </select>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        「こどもの居場所カレンダー」に載せるかどうかの目印です。分からなければ「自動」のままで構いません。
        {autoLabel && defaultValue === '' && <> いまは自動判定で「{autoLabel}」になっています。</>}
      </p>
    </div>
  )
}
