'use client'

// タイムトライアル記録の削除・全リセットボタン（確認ダイアログ付き）

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteTrial, resetAllTrials } from '../actions'

export function DeleteTrialButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`「${name}」の記録を削除します。よろしいですか？`)) return
        startTransition(async () => {
          const res = await deleteTrial(id)
          if (!res.ok) alert(`削除に失敗しました: ${res.error}`)
          router.refresh()
        })
      }}
      className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
    >
      {pending ? '削除中…' : '削除'}
    </button>
  )
}

export function ResetAllButton({ total }: { total: number }) {
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState('')
  const router = useRouter()
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="「リセット」と入力"
        className="text-sm px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 w-40"
      />
      <button
        type="button"
        disabled={pending || text !== 'リセット'}
        onClick={() => {
          if (!confirm(`全${total}件の記録をすべて削除します。取り消しはできません。よろしいですか？`)) return
          startTransition(async () => {
            const res = await resetAllTrials()
            if (!res.ok) alert(`リセットに失敗しました: ${res.error}`)
            setText('')
            router.refresh()
          })
        }}
        className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
      >
        {pending ? 'リセット中…' : '🗑 全記録をリセット'}
      </button>
    </div>
  )
}
