'use client'

import { useState, useTransition } from 'react'
import { setRotationSchedule, type RotationPreset } from '../actions'

// 定期紹介ローテーションの実行間隔設定。
// プリセット選択制（自由 cron 入力は誤設定防止のため設けない）。
// 「停止」してもボタンの「今すぐ実行」は使えるため、手動運用へ切り替えられる。

const PRESET_LABEL: Record<RotationPreset, string> = {
  daily: '毎日',
  every2days: '隔日',
  weekly: '週1回（月曜）',
  monthly: '月1回（1日）',
  off: '停止',
}

const PRESET_ORDER: RotationPreset[] = ['daily', 'every2days', 'weekly', 'monthly', 'off']

export default function RotationScheduleCard({ current }: { current: RotationPreset | null }) {
  const [selected, setSelected] = useState<RotationPreset>(current ?? 'off')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const dirty = selected !== (current ?? 'off')

  function onSave() {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const res = await setRotationSchedule(selected)
      if (res.ok) {
        setMessage(`実行間隔を「${PRESET_LABEL[selected]}」に変更しました`)
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
      <h2 className="text-lg font-semibold mb-1">⏱ 定期紹介の実行間隔</h2>
      <p className="text-xs text-slate-500 mb-3">
        FreeFree・団体の紹介下書きを自動生成する間隔です（実行時刻は日本時間 朝9時。イベントはまとめ配信のため対象外）。
        「停止」中も「今すぐ1件ピックアップ」による手動実行は使えます。
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESET_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => setSelected(p)}
            className={
              'text-xs px-2.5 py-1 rounded-full border transition ' +
              (selected === p
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:border-slate-500')
            }
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={onSave}
          className="ml-2 text-xs px-3 py-1 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 disabled:opacity-40"
        >
          {pending ? '変更中…' : '変更を保存'}
        </button>
      </div>
      <div className="mt-2 text-xs">
        <span className="text-slate-500">現在の設定: {current ? PRESET_LABEL[current] : '停止（ジョブなし）'}</span>
        {message && <span className="ml-3 text-emerald-600 dark:text-emerald-400">{message}</span>}
        {error && <span className="ml-3 text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </section>
  )
}
