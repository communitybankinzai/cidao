'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { replyTalentInquiry } from '../../../talent/actions'
import { nameWithSan } from '@/lib/honorific'

export function ReplyForm({
  rootInquiryId,
  otherName,
}: {
  rootInquiryId: string
  otherName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-2">
        {notice && <p className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>}
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => { setOpen(true); setNotice(null) }}>
            ↩ 返信する
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={600}
        placeholder={`${nameWithSan(otherName)}への返信を書く…`}
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
      />
      <p className="text-[10px] text-slate-400 text-right">{message.trim().length} / 600 字</p>
      <p className="text-[10px] text-slate-400">
        ※ 相手にはベル通知と、（登録メールがある場合は）メールで届きます。メール送信時はあなたの登録メールアドレスが相手に開示されます。
      </p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => { setOpen(false); setError(null) }} disabled={pending}>
          キャンセル
        </Button>
        <Button
          size="sm"
          disabled={pending || message.trim().length < 1}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                const r = await replyTalentInquiry(rootInquiryId, message)
                setMessage('')
                setOpen(false)
                setNotice(r.emailSent ? '✓ 返信を送信しました（メール通知あり）' : '✓ 返信を送信しました')
                router.refresh()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            })
          }}
        >
          {pending ? '送信中…' : '返信を送る'}
        </Button>
      </div>
    </div>
  )
}
