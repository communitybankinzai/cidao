'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { sendBroadcastNotice } from '../actions'

const INPUT_CLASS =
  'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm'

export default function NoticeForm({ memberCount }: { memberCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [push, setPush] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    setMessage(null)
    const result = await sendBroadcastNotice({ title, body, linkUrl, push })
    setSending(false)
    setConfirming(false)
    if (!result.ok) {
      setMessage(`❌ ${result.error}`)
      return
    }
    setMessage(
      `✓ ${result.recipients}人のベルに配信しました（Webプッシュ ${result.pushed}台）`,
    )
    setTitle('')
    setBody('')
    setLinkUrl('')
    startTransition(() => router.refresh())
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">📣 一斉お知らせを送る</h2>
        <p className="text-xs text-slate-500 mt-1">
          登録メンバー全員（現在 {memberCount}人）のベル🔔に届きます。
          Webプッシュを許可している人には、スリープ中の端末にも通知が出ます。
          <strong className="text-slate-700 dark:text-slate-300">送信の取り消しはできません。</strong>
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">タイトル（必須・200字以内）</span>
        <input
          className={INPUT_CLASS}
          value={title}
          maxLength={200}
          onChange={(e) => { setTitle(e.target.value); setConfirming(false) }}
          placeholder="例）8月の定例会は8/10(月) 19時からです"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">本文（任意・1000字以内）</span>
        <textarea
          className={`${INPUT_CLASS} min-h-24`}
          value={body}
          maxLength={1000}
          onChange={(e) => { setBody(e.target.value); setConfirming(false) }}
          placeholder="例）場所は市民活動支援センターです。欠席の方は事前にご連絡ください。"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">リンク先（任意・サイト内のパス）</span>
        <input
          className={INPUT_CLASS}
          value={linkUrl}
          onChange={(e) => { setLinkUrl(e.target.value); setConfirming(false) }}
          placeholder="/events"
        />
        <span className="text-xs text-slate-500">
          通知をタップしたときに開くページ。空欄なら遷移しません
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
        Webプッシュでも鳴らす（外すとベルのみ）
      </label>

      {!confirming ? (
        <Button
          onClick={() => { setMessage(null); setConfirming(true) }}
          disabled={title.trim().length === 0 || sending}
          size="sm"
        >
          送信内容を確認する
        </Button>
      ) : (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded p-3 space-y-2">
          <p className="text-sm">
            この内容で <strong>{memberCount}人</strong> に送信します。よろしいですか？
          </p>
          <div className="flex gap-2">
            <Button onClick={send} disabled={sending} size="sm">
              {sending ? '送信中…' : '📣 全員に送信する'}
            </Button>
            <Button onClick={() => setConfirming(false)} disabled={sending} size="sm" variant="outline">
              やめる
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p className="text-sm bg-slate-100 dark:bg-slate-800 rounded p-2">{message}</p>
      )}
      {pending && <p className="text-xs text-slate-500">履歴を更新中…</p>}
    </section>
  )
}
