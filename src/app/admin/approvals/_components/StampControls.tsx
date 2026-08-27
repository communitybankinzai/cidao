'use client'

// 押印（承認・却下・保留）・押印取消・取り下げ・本文修正の操作部品。
// 表示可否はサーバー側（詳細ページ）で判定済みだが、Server Actions 側でも
// 二重に検証している（利益相反の当事者・監査役・決裁終了後は押せない）。

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { revokeStamp, stampRequest, updateRequestBody, withdrawRequest } from '../actions'
import { ACTION_LABEL, type StampAction } from '@/lib/approval'

export function StampControls({ requestId, myIntent }: { requestId: string; myIntent: StampAction | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  const act = (action: 'approve' | 'reject' | 'hold') => {
    const label = ACTION_LABEL[action]
    if (!confirm(`「${label}」の電子印を押します。押印は記録に残り、あとから変更できません。よろしいですか？`)) return
    setError('')
    startTransition(async () => {
      const res = await stampRequest(requestId, action, comment)
      if (!res.ok) { setError(res.error); return }
      setComment('')
      router.refresh()
    })
  }

  const revoke = () => {
    if (!confirm('自分の押印を取り消します（取消の記録が残ります）。よろしいですか？')) return
    setError('')
    startTransition(async () => {
      const res = await revokeStamp(requestId)
      if (!res.ok) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-800 rounded-lg p-5 space-y-3">
      <h2 className="text-lg font-semibold">🖊 押印する</h2>
      {myIntent && (
        <p className="text-sm text-slate-500">
          現在のあなたの意思表示: <b>{ACTION_LABEL[myIntent]}</b>。
          押し直す場合は、いったん取り消してから押印し直してください。
        </p>
      )}
      <div>
        <label className="block text-sm font-semibold mb-1">コメント（任意）</label>
        <textarea
          value={comment} rows={2} maxLength={1000}
          onChange={(e) => setComment(e.target.value)}
          placeholder="例: 予算の範囲内であることを確認しました"
          className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-600">⚠ {error}</p>}
      <div className="flex flex-wrap gap-2">
        {!myIntent && (
          <>
            <button
              type="button" disabled={pending} onClick={() => act('approve')}
              className="px-5 py-2 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              ✅ 承認
            </button>
            <button
              type="button" disabled={pending} onClick={() => act('reject')}
              className="px-5 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              ❌ 却下
            </button>
            <button
              type="button" disabled={pending} onClick={() => act('hold')}
              className="px-5 py-2 rounded bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
            >
              ⏸ 保留
            </button>
          </>
        )}
        {myIntent && (
          <button
            type="button" disabled={pending} onClick={revoke}
            className="px-5 py-2 rounded border border-slate-400 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            ↩ 押印を取り消す
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        押印の時刻はサーバーの時計で記録されます。押印・取消はすべて履歴に残ります。
      </p>
    </section>
  )
}

export function WithdrawButton({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  return (
    <div>
      <button
        type="button" disabled={pending}
        onClick={() => {
          if (!confirm('この起案を取り下げます。取り下げた案件は再開できません（必要なら改めて起案してください）。よろしいですか？')) return
          setError('')
          startTransition(async () => {
            const res = await withdrawRequest(requestId)
            if (!res.ok) { setError(res.error); return }
            router.refresh()
          })
        }}
        className="px-4 py-2 rounded border border-red-300 text-red-600 text-sm hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
      >
        🗑 この起案を取り下げる
      </button>
      {error && <p className="text-sm text-red-600 mt-1">⚠ {error}</p>}
    </div>
  )
}

export function EditBodyForm({
  requestId,
  initialBody,
  hasStamps,
}: {
  requestId: string
  initialBody: string
  hasStamps: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState(initialBody)
  const [error, setError] = useState('')

  if (!open) {
    return (
      <div>
        <button
          type="button" onClick={() => setOpen(true)}
          className="px-4 py-2 rounded border border-slate-400 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          ✏ 本文を修正する
        </button>
        {hasStamps && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            ※ 本文を修正すると、これまでの押印はすべて無効になり、各役員の押し直しが必要になります（改ざん防止のため）。
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold">本文の修正</label>
      <textarea
        value={body} rows={10} maxLength={10000}
        onChange={(e) => setBody(e.target.value)}
        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
      />
      {hasStamps && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          ⚠ 保存すると、これまでの押印はすべて「本文変更前の押印」として無効になります。
        </p>
      )}
      {error && <p className="text-sm text-red-600">⚠ {error}</p>}
      <div className="flex gap-2">
        <button
          type="button" disabled={pending}
          onClick={() => {
            if (hasStamps && !confirm('本文を保存すると、これまでの押印はすべて無効になります。よろしいですか？')) return
            setError('')
            startTransition(async () => {
              const res = await updateRequestBody(requestId, body)
              if (!res.ok) { setError(res.error); return }
              setOpen(false)
              router.refresh()
            })
          }}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存する'}
        </button>
        <button
          type="button" disabled={pending}
          onClick={() => { setOpen(false); setBody(initialBody); setError('') }}
          className="px-4 py-2 rounded border border-slate-400 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          やめる
        </button>
      </div>
    </div>
  )
}
