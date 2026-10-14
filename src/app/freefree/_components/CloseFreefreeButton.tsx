'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closeFreefreePost } from '../actions'

/**
 * 「募集を打ち切る」。終了日を待たずに、その場で掲載を終了する。
 * 取り消せない操作なので、押したあとに確認を出す。
 */
export function CloseFreefreeButton({ postId }: { postId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    const ok = window.confirm(
      '募集を打ち切りますか？\n\n' +
        '・この掲載は、今すぐ掲示板から外れます（元に戻せません）\n' +
        '・予定していたSNSでの告知も取りやめます\n' +
        '・すでにSNSへ出た投稿は消えません',
    )
    if (!ok) return
    setError(null)
    startTransition(async () => {
      try {
        await closeFreefreePost(postId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '終了に失敗しました')
      }
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-rose-700 dark:text-rose-400 hover:underline disabled:opacity-50"
      >
        {pending ? '終了しています…' : '⏹ 募集を打ち切る'}
      </button>
      {error && <span className="text-rose-600">{error}</span>}
    </span>
  )
}
