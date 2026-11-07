'use client'

// 会員一覧の各行に置く「お知らせを送る」ボタンと送信画面。ベル🔔＋Webプッシュで1人に届く。
// 送る前に必ず確認の1段を挟む（送信の取り消しはできないため）。

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DIRECT_NOTICE_BODY_MAX,
  DIRECT_NOTICE_PURPOSES,
  DIRECT_NOTICE_TITLE_MAX,
  canSendDirectNotice,
  validateDirectNotice,
  type DirectNoticePurpose,
} from '@/lib/direct-notice'
import { sendDirectNotice } from '../actions'

const INPUT_CLASS =
  'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm'

export default function DirectNoticeButton({
  memberId,
  displayName,
  realName,
  contactPermission,
}: {
  memberId: string
  displayName: string
  realName?: string | null
  contactPermission: boolean | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // 既定は「お誘い」。連絡許可のない人には、この既定のままでは送れない（手続き・サポートを選ぶと送れる）
  const [purpose, setPurpose] = useState<DirectNoticePurpose>('invite')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !sending) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, sending])

  const checked = validateDirectNotice({ title, body, linkUrl })
  const allowed = canSendDirectNotice({ contactPermission, purpose })
  const problem = !allowed.ok ? allowed.reason : !checked.ok && title.trim().length > 0 ? checked.error : null
  const canConfirm = allowed.ok && checked.ok && !sending

  function edit(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setConfirming(false)
      setMessage(null)
    }
  }

  async function send() {
    setSending(true)
    setMessage(null)
    const result = await sendDirectNotice({ memberId, purpose, title, body, linkUrl })
    setSending(false)
    setConfirming(false)
    if (!result.ok) {
      setMessage(`❌ ${result.error}`)
      return
    }
    setMessage(
      `✓ ${displayName}さんに送りました（プッシュ ${result.pushed}台）` +
        (result.recorded ? '' : '。ただし送信の記録を残せませんでした'),
    )
    setTitle('')
    setBody('')
    setLinkUrl('')
    router.refresh()
  }

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          setMessage(null)
          setOpen(true)
        }}
      >
        お知らせを送る
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${displayName}さんにお知らせを送る`}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border bg-white dark:bg-slate-900 p-5 space-y-4 text-left"
          >
            <div>
              <h2 className="text-lg font-semibold">{displayName}さんにお知らせを送る</h2>
              <p className="text-xs text-slate-500 mt-1">
                {realName ? `実名：${realName}（運営だけに見えています）　` : ''}
                <span
                  className={
                    'px-1.5 py-0.5 rounded text-[10px] font-semibold ' +
                    (contactPermission
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
                  }
                >
                  {contactPermission ? '連絡許可あり' : '連絡許可なし'}
                </span>
              </p>
              <p className="text-xs text-slate-500 mt-2">
                この方のベル🔔に届きます。プッシュ通知を許可している端末には、スリープ中でも通知が出ます。
                <strong className="text-slate-700 dark:text-slate-300">送信の取り消しはできません。</strong>
              </p>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">連絡の種類</legend>
              {DIRECT_NOTICE_PURPOSES.map((p) => (
                <label key={p.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={`purpose-${memberId}`}
                    className="mt-1"
                    checked={purpose === p.value}
                    onChange={() => {
                      setPurpose(p.value)
                      setConfirming(false)
                      setMessage(null)
                    }}
                  />
                  <span>
                    {p.label}
                    <span className="block text-xs text-slate-500">{p.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="block space-y-1">
              <span className="text-sm font-medium">タイトル（必須・{DIRECT_NOTICE_TITLE_MAX}字以内）</span>
              <input
                className={INPUT_CLASS}
                value={title}
                maxLength={DIRECT_NOTICE_TITLE_MAX}
                onChange={(e) => edit(setTitle)(e.target.value)}
                placeholder="例）登録のお手伝いをさせてください"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">本文（任意・{DIRECT_NOTICE_BODY_MAX}字以内）</span>
              <textarea
                className={`${INPUT_CLASS} min-h-24`}
                value={body}
                maxLength={DIRECT_NOTICE_BODY_MAX}
                onChange={(e) => edit(setBody)(e.target.value)}
                placeholder="例）運営の○○です。困っていることがあれば、このお知らせへの返信ではなく…"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">リンク先（任意・サイト内のパス）</span>
              <input
                className={INPUT_CLASS}
                value={linkUrl}
                onChange={(e) => edit(setLinkUrl)(e.target.value)}
                placeholder="/me/edit"
              />
              <span className="text-xs text-slate-500">
                通知をタップしたときに開くページ。空欄なら遷移しません
              </span>
            </label>

            {problem && (
              <p className="text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-300 rounded p-2">
                {problem}
              </p>
            )}

            {!confirming ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={!canConfirm} onClick={() => { setMessage(null); setConfirming(true) }}>
                  送信内容を確認する
                </Button>
                <Button size="sm" variant="outline" disabled={sending} onClick={() => setOpen(false)}>
                  閉じる
                </Button>
              </div>
            ) : (
              <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded p-3 space-y-2">
                <p className="text-sm">
                  この内容で <strong>{displayName}さん</strong> に送信します。よろしいですか？
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={send} disabled={sending}>
                    {sending ? '送信中…' : '📨 この方に送信する'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={sending} onClick={() => setConfirming(false)}>
                    やめる
                  </Button>
                </div>
              </div>
            )}

            {message && (
              <p className="text-sm bg-slate-100 dark:bg-slate-800 rounded p-2">{message}</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
