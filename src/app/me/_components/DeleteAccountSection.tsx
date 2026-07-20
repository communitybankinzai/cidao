'use client'

import { useState } from 'react'
import { deleteAccount } from '../actions'

export default function DeleteAccountSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    const ok = window.confirm(
      '退会するとプロフィールは非公開になり、ログインできなくなります。\n' +
      '30日以内に再ログインすればアカウントを復元できます。\n\n' +
      '退会してよろしいですか？'
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
    } catch (e) {
      // redirect() は例外として伝播するため、それ以外のみエラー表示
      if (e instanceof Error && !e.message.includes('NEXT_REDIRECT')) {
        setError(e.message)
        setBusy(false)
      }
    }
  }

  return (
    <section className="border border-red-200 dark:border-red-900 rounded-lg p-4 space-y-2">
      <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">退会</h2>
      <p className="text-xs text-slate-500 leading-relaxed">
        退会するとプロフィールは非公開になります。30日以内に再ログインすれば復元できます。
        提案・投票などの活動記録は統計のため匿名化して保持されます。
      </p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
      >
        {busy ? '処理中…' : 'アカウントを退会する'}
      </button>
    </section>
  )
}
