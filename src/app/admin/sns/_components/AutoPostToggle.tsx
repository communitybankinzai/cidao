'use client'

import { useState, useTransition } from 'react'
import { setSnsAutoPost } from '../actions'

// 提案告知の全自動／半自動モード切替スイッチ。
// 全自動は承認なしで外部発信するため、切り替え時に確認ダイアログを挟む。
export default function AutoPostToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    const next = !enabled
    if (next && !window.confirm(
      '全自動モードにすると、提案が作成された瞬間に承認なしで各SNSへ配信されます。\n'
      + '外部発信の事前確認（運営承認）を省略する運用になりますが、よろしいですか？'
    )) return

    setError(null)
    startTransition(async () => {
      try {
        await setSnsAutoPost(next)
        setEnabled(next)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">📮 提案告知の配信モード</h2>
          <p className="text-xs text-slate-500 mt-1">
            {enabled
              ? '全自動：提案が作成されると、承認なしで各SNSへ即配信されます'
              : '半自動：提案が作成されると告知文が「承認待ち」になり、管理者へ通知が届きます。承認したものだけが配信されます'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={pending}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
            enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
          } ${pending ? 'opacity-50' : ''}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <div className="mt-2 text-xs">
        <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${
          enabled
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
        }`}>
          {enabled ? '⚡ 全自動' : '✋ 半自動（承認制）'}
        </span>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">❌ {error}</p>}
    </section>
  )
}
