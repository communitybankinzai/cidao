'use client'

import { useState } from 'react'

/**
 * イベントの登録・編集フォームの「終了」欄（2026-11-27 事業主決定）。
 * 「終了時刻は未定」にチェックを入れると、終了日時の入力が要らなくなる。
 * 保存のときは、未定なら開始の1時間後が終了日時として入る（カレンダーなどの計算に使うため）。画面には終了時刻を出さない。
 *
 * AI の読み取り（ImageScanField の fillForm）は、name="end_time_unknown" のチェック欄を click() で切り替える。
 */
export function EndTimeField({
  className,
  defaultValue = '',
  defaultUnknown = false,
}: {
  className: string
  defaultValue?: string
  defaultUnknown?: boolean
}) {
  const [unknown, setUnknown] = useState(defaultUnknown)
  return (
    <div className="space-y-1">
      <label htmlFor="event-end-at" className="text-sm font-medium">
        終了{!unknown && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {/* 未定のときも入力欄は消さず、隠すだけにする（AI の読み取りが値を入れられるように。保存のときはサーバーが無視する） */}
      <input
        id="event-end-at"
        type="datetime-local"
        name="end_at"
        required={!unknown}
        defaultValue={defaultValue}
        className={`${className}${unknown ? ' hidden' : ''}`}
      />
      {unknown && <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">終了時刻は未定</p>}
      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          name="end_time_unknown"
          checked={unknown}
          onChange={(e) => setUnknown(e.target.checked)}
        />
        終了時刻は未定（決まっていない・書かれていない）
      </label>
    </div>
  )
}
