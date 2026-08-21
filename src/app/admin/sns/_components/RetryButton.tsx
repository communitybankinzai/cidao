'use client'

// 投稿ログの「✗失敗」行に付ける再試行ボタン。
// 承認済みの本文のまま、その場で配信し直す。
import { useState, useTransition } from 'react'
import { retryFailedLog } from '../actions'

export default function RetryButton({ logId, label }: { logId: string; label: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function retry() {
    if (!window.confirm(`「${label}」を再投稿します。よろしいですか？`)) return
    setMessage(null)
    startTransition(async () => {
      const r = await retryFailedLog(logId)
      setMessage(r.ok ? '✓ 再投稿しました' : `❌ ${r.error}`)
    })
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="px-1.5 py-0 rounded border border-slate-300 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
      >
        {pending ? '再試行中…' : '🔁 再試行'}
      </button>
      {message && <span className="text-[10px]">{message}</span>}
    </span>
  )
}
