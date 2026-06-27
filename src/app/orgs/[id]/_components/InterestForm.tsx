'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { expressInterest } from '../../actions'

export function InterestForm({
  orgId,
  orgName,
  lastAppliedAt,
  myTier,
  isLoggedIn,
  hasOrgEmail,
}: {
  orgId: string
  orgName: string
  lastAppliedAt: string | null
  myTier: string | null
  isLoggedIn: boolean
  hasOrgEmail: boolean
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [contactOk, setContactOk] = useState(true)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; emailSent: boolean; emailError: string | null; hasOrgEmail: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isLoggedIn) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-sm space-y-2">
        <p className="text-slate-700 dark:text-slate-300">
          <span className="font-semibold">この団体で活動したい人を募集しています</span>
        </p>
        <p className="text-xs text-slate-500">
          人材バンクに登録すると、このような団体に「活動に参加したい」と申し出ることができます。
        </p>
        <a
          href={`/login?next=/orgs/${orgId}`}
          className="inline-block text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-medium"
        >
          ログインして人材バンクに登録
        </a>
      </div>
    )
  }

  if (myTier === 'light') {
    return (
      <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-amber-900 dark:text-amber-100">
          本登録（人材バンク登録）すると、この団体に参加意思を伝えられます
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          /me/edit で興味分野と自己紹介を入力すると、応募できるようになります。
        </p>
        <a
          href="/me/edit"
          className="inline-block text-sm bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded font-medium"
        >
          本登録フォームを開く
        </a>
      </div>
    )
  }

  // 直近の送信結果（このセッションでの送信）
  if (result) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
          ✓ 「活動に参加したい」を送信しました
        </p>
        {result.emailSent && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            {orgName} の連絡先メールに通知が送信されました。返事は団体から直接届きます。
          </p>
        )}
        {!result.emailSent && hasOrgEmail && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            記録は保存されました。ただし通知メールは送信できませんでした（{result.emailError ?? 'unknown'}）。
          </p>
        )}
        {!result.hasOrgEmail && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            記録は保存されましたが、この団体には連絡先メールが登録されていないため、直接の通知は届いていません。
          </p>
        )}
        <button
          type="button"
          onClick={() => { setResult(null); setMessage(''); setOpen(true) }}
          className="text-xs text-emerald-700 dark:text-emerald-300 underline hover:no-underline"
        >
          もう一度送信する
        </button>
      </div>
    )
  }

  // 過去に応募したことがある（別セッション・前回送信）
  if (lastAppliedAt && !open) {
    const dateStr = new Date(lastAppliedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
          ✓ {orgName} には {dateStr} に応募済み
        </p>
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          団体からの返事が届いていない場合や、追加で伝えたいことがある場合は再度メッセージを送れます。
        </p>
        <Button onClick={() => setOpen(true)} size="sm" variant="outline">
          もう一度送信する
        </Button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 text-sm space-y-2">
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          🤝 この団体で活動したい人を募集しています
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {hasOrgEmail
            ? '応募ボタンを押すと、団体の連絡先にあなたのメッセージが届きます。'
            : 'この団体には連絡先メールが登録されていません。意思表示は記録されますが、団体への直接通知は届きません。'}
        </p>
        <Button onClick={() => setOpen(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
          この団体で活動したい
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-3">
      <p className="font-semibold text-slate-900 dark:text-slate-100">
        🤝 {orgName} に「活動に参加したい」と伝える
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={400}
        placeholder={`例: ${orgName} の活動に興味があります。動画編集やイベント運営の経験があるので、運営側でも参加側でも関わりたいです。まずは見学からでも可能でしょうか。`}
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
      />
      <p className="text-[10px] text-slate-400 text-right">
        {message.trim().length} / 400 字
      </p>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={contactOk}
          onChange={(e) => setContactOk(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-slate-600 dark:text-slate-400">
          私のメールアドレスを団体に開示することを承諾します（チェックを外すと記録のみ・団体への通知は行われません）。
        </span>
      </label>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => { setOpen(false); setError(null) }} disabled={pending}>
          キャンセル
        </Button>
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
          disabled={pending || message.trim().length < 1}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                const r = await expressInterest(orgId, message, contactOk)
                setResult(r)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            })
          }}
        >
          {pending ? '送信中…' : '送信する'}
        </Button>
      </div>
    </div>
  )
}
