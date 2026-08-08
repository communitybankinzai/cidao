'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { hideFreefreePost, restoreFreefreePost, deleteFreefreePost } from '../actions'

export type ModerationPost = {
  id: string
  title: string
  body: string
  status: string
  category: string
  location: string | null
  created_at: string
  expires_at: string | null
  posterLabel: string
  moderationNote: string | null
  looksLikeSample: boolean
}

export default function FreefreeModerationRow({ post }: { post: ModerationPost }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const removed = post.status === 'removed'

  function run(fn: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <li
      className={`border rounded-lg p-3 space-y-2 ${
        removed
          ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-xs shrink-0 text-slate-500">{post.posterLabel}</span>
        {post.looksLikeSample && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
            サンプルらしい
          </span>
        )}
        {removed && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            非公開
          </span>
        )}
        <Link
          href={`/freefree/${post.id}`}
          target="_blank"
          className="flex-1 min-w-0 truncate font-medium text-sm hover:underline"
        >
          {post.title}
        </Link>
        <span className="text-[11px] text-slate-400 shrink-0">
          {new Date(post.created_at).toLocaleDateString('ja-JP')}
        </span>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{post.body}</p>

      {post.moderationNote && (
        <p className="text-[11px] text-slate-500">非公開の理由: {post.moderationNote}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {!removed && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="非公開の理由（任意・運営内メモ）"
            className="flex-1 min-w-[12rem] text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
          />
        )}
        <div className="flex-1" />
        {removed ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => restoreFreefreePost(post.id))}>
            元に戻す
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => hideFreefreePost(post.id, note))}>
            非公開にする
          </Button>
        )}
        {confirmingDelete ? (
          <>
            <span className="text-[11px] text-red-600">元に戻せません。よろしいですか？</span>
            <Button
              type="button"
              disabled={pending}
              className="bg-red-600 hover:bg-red-700"
              onClick={() => run(() => deleteFreefreePost(post.id))}
            >
              完全に削除する
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmingDelete(false)}>
              やめる
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmingDelete(true)}>
            完全に削除…
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {pending && <p className="text-xs text-slate-500">処理中…</p>}
    </li>
  )
}
