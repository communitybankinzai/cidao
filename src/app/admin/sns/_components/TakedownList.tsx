'use client'

// 「SNS削除待ち」の一覧。FreeFree の掲載を取り下げたときに、SNS へ出ていた紹介投稿の削除を運営が済ませたか管理する。
// 各 SNS で投稿を削除したあとに「削除済みにする」を押す（SNS 側は自動では消えない）。
import { useState, useTransition } from 'react'
import { markTakedownRemoved } from '../actions'

export type TakedownItem = {
  id: string
  postTitle: string
  mediumLabel: string
  postedId: string | null
  postUrl: string | null
  withdrawnAt: string
  reason: 'hidden' | 'deleted'
  removedAt: string | null
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Row({ item }: { item: TakedownItem }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const done = item.removedAt !== null

  function remove() {
    if (!window.confirm(`「${item.postTitle}」の ${item.mediumLabel} の投稿を、各SNSで削除し終えましたか？`)) return
    setMessage(null)
    startTransition(async () => {
      const r = await markTakedownRemoved(item.id)
      if (!r.ok) setMessage(`❌ ${r.error}`)
    })
  }

  return (
    <li className={`flex flex-wrap items-center gap-2 text-sm border-b border-slate-100 dark:border-slate-800 py-2 ${done ? 'opacity-50' : ''}`}>
      <span className="w-24 shrink-0 text-xs">{item.mediumLabel}</span>
      <span className="flex-1 min-w-[10rem]">
        <span className="font-medium">{item.postTitle}</span>
        <span className="block text-[11px] text-slate-500">
          {item.reason === 'deleted' ? '完全削除' : '非公開'} {fmt(item.withdrawnAt)}
          {' ・ '}
          {item.postUrl
            ? <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="underline">{item.postUrl}</a>
            : item.postedId ? `投稿ID ${item.postedId}` : '投稿IDなし（各SNSで掲載名を探してください）'}
        </span>
      </span>
      {done ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ 削除済み {fmt(item.removedAt!)}</span>
      ) : (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          {pending ? '記録中…' : '削除済みにする'}
        </button>
      )}
      {message && <span className="text-xs w-full">{message}</span>}
    </li>
  )
}

export default function TakedownList({ items }: { items: TakedownItem[] }) {
  return (
    <ul>
      {items.map((it) => <Row key={it.id} item={it} />)}
    </ul>
  )
}
