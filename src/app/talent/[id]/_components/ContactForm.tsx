'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { sendTalentInquiry } from '../../actions'

export function ContactForm({
  targetMemberId,
  targetName,
  isLoggedIn,
  myTier,
  acceptanceMode,
}: {
  targetMemberId: string
  targetName: string
  isLoggedIn: boolean
  myTier: string | null
  /** open / recommended_only / closed */
  acceptanceMode: string | null
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; emailSent: boolean; emailError: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isLoggedIn) {
    return (
      <div className="bg-white dark:bg-slate-900 border rounded-lg p-6 text-center space-y-2">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          <strong>{targetName}</strong> さんに声をかけたい場合はログインしてください
        </p>
        <a href={`/login?next=/talent/${targetMemberId}`} className="inline-block">
          <Button>ログイン</Button>
        </a>
      </div>
    )
  }

  if (myTier === 'light') {
    return (
      <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-amber-900 dark:text-amber-100">
          本登録（プロフィール完成）後にコンタクトできます
        </p>
        <a href="/me/edit" className="inline-block">
          <Button size="sm">本登録フォームを開く</Button>
        </a>
      </div>
    )
  }

  if (result) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
          ✓ メッセージを送信しました
        </p>
        {result.emailSent && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            {targetName} さんの登録メールに通知が送られました。返事は直接メールで届きます。
          </p>
        )}
        {!result.emailSent && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            メッセージは記録されました。ただし通知メールは送信できませんでした（{result.emailError ?? 'unknown'}）。
          </p>
        )}
        <button
          type="button"
          onClick={() => { setResult(null); setMessage(''); setOpen(false) }}
          className="text-xs text-emerald-700 dark:text-emerald-300 underline hover:no-underline"
        >
          もう一度送信する
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-lg p-4 text-sm space-y-2">
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          ✉️ {targetName} さんに声をかける
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          送信ボタンを押すと、相手の登録メールアドレスにあなたのメッセージが届きます。返信はメールで直接やり取りできます。
        </p>
        {acceptanceMode === 'recommended_only' && (
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            ※ このメンバーは「推薦経由のみ受け付け」を設定していますが、現状の MVP では一律送信可能です。
          </p>
        )}
        <Button onClick={() => setOpen(true)} size="sm">
          メッセージを書く
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-lg p-4 space-y-3">
      <p className="font-semibold text-slate-900 dark:text-slate-100">
        ✉️ {targetName} さんに声をかける
      </p>
      <p className="text-xs text-slate-500">
        自己紹介・どんな活動への参加を依頼したいか・連絡可能な時間帯などを書くと話が早いです。
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        maxLength={600}
        placeholder={`例: 印西市内で里山保全活動をしている『○○の会』の代表 ◯◯と申します。${targetName} さんのスキルにとても関心があり、ぜひ一度お話できればと思います。平日夜のオンライン or 週末の現地見学いずれでも対応可能です。`}
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
      />
      <p className="text-[10px] text-slate-400 text-right">
        {message.trim().length} / 600 字
      </p>
      <p className="text-[10px] text-slate-400">
        ※ 送信時にあなたの登録メールアドレスが相手に開示されます（相手が直接返信できるようにするため）。
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
                const r = await sendTalentInquiry(targetMemberId, message)
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
