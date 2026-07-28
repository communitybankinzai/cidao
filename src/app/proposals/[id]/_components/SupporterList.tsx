'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { sendProposalOutreachMessage } from '@/app/talent/actions'

export type Supporter = {
  id: string
  displayName: string
  avatarUrl: string | null
}

/**
 * 提案者だけに見える「協力したいと名乗り出た人」の一覧。
 * ここから直接声をかけられる（やりとりは受信箱に続く）。
 */
export function SupporterList({
  proposalId,
  supporters,
}: {
  proposalId: string
  supporters: Supporter[]
}) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 rounded-lg p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-emerald-700 dark:text-emerald-400 uppercase">
          協力したいと名乗り出た人（{supporters.length}名）
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          「大賛成」で投票し、あなたに名前を伝えることを選んだ人です。あなただけに表示されます。
        </p>
      </div>

      <ul className="space-y-3">
        {supporters.map((s) => (
          <SupporterRow key={s.id} proposalId={proposalId} supporter={s} />
        ))}
      </ul>

      <p className="text-[11px] text-slate-400">
        送ったメッセージへの返信は <Link href="/me/inbox" className="underline">受信箱</Link> に届きます。
      </p>
    </section>
  )
}

function SupporterRow({
  proposalId,
  supporter,
}: {
  proposalId: string
  supporter: Supporter
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    const trimmed = message.trim()
    if (trimmed.length < 1) {
      setError('メッセージを入力してください')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await sendProposalOutreachMessage(proposalId, supporter.id, trimmed)
        setMessage('')
        setSent(true)
        setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <li className="border border-slate-200 dark:border-slate-800 rounded p-3 space-y-2">
      <div className="flex items-center gap-3">
        <Avatar src={supporter.avatarUrl} name={supporter.displayName} size="sm" />
        <Link
          href={`/talent/${supporter.id}`}
          className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline"
        >
          {supporter.displayName}
        </Link>
        <Button
          size="sm"
          variant={open ? 'secondary' : 'outline'}
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '閉じる' : 'メッセージを送る'}
        </Button>
      </div>

      {open && (
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={600}
            rows={3}
            disabled={pending}
            placeholder="例：ありがとうございます。準備会を来週開きます。ご都合はいかがですか。"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{message.length}/600</span>
            <Button size="sm" disabled={pending} onClick={submit}>
              {pending ? '送信中…' : '送信'}
            </Button>
          </div>
        </div>
      )}

      {sent && (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ 送信しました</p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </li>
  )
}
