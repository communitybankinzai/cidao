'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { submitBugReport } from '../actions'

const CATEGORIES = [
  { value: 'question', label: '使い方の質問・相談（提案の書き方など）' },
  { value: 'bug', label: '不具合（動かない・表示がおかしい）' },
  { value: 'feature_request', label: '要望（こうしてほしい）' },
  { value: 'other', label: 'その他' },
] as const
export type BugReportCategory = (typeof CATEGORIES)[number]['value']

const PLACEHOLDER: Record<BugReportCategory, string> = {
  question: '例: 提案を出してみたいのですが、何をどう書けばよいかわかりません。考えていることは「○○」です。',
  bug: '例: スマホでログインボタンを押すと画面が白くなって何も表示されません。機種はiPhone、ブラウザはSafariです。',
  feature_request: '例: イベント一覧を地図でも見られるようにしてほしいです。',
  other: '',
}

export function BugReportForm({
  source,
  isLoggedIn,
  defaultEmail,
  contextLabel,
  topicLabel,
  defaultCategory,
  defaultPageUrl = '',
}: {
  source: 'cbi_site' | 'cidao_app'
  isLoggedIn: boolean
  defaultEmail: string
  /** 通知から来た場合の件名（「〇〇について」と画面に出し、本文の先頭にも入れる） */
  contextLabel?: string
  /** 相談の入口から来た場合の話題（例「提案の書き方」。画面に出し、本文の先頭にも入れる） */
  topicLabel?: string
  /** 最初に選んでおく種別（相談の入口からは question） */
  defaultCategory?: BugReportCategory
  defaultPageUrl?: string
}) {
  const [category, setCategory] = useState<BugReportCategory>(
    defaultCategory ?? (contextLabel ? 'other' : 'bug'),
  )
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState(defaultPageUrl)
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState(defaultEmail)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; emailSent: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (result) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">✓ 送信しました</p>
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          ありがとうございます。運営が確認のうえ対応します。
          {isLoggedIn ? '返事は画面右上のベル🔔に届きます。' : '返事が必要な場合は、メールアドレスの入力があれば運営から連絡します。'}
        </p>
        <button
          type="button"
          onClick={() => {
            setResult(null)
            setDescription('')
            setPageUrl('')
          }}
          className="text-xs text-emerald-700 dark:text-emerald-300 underline hover:no-underline"
        >
          もう一件送る
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-lg p-4 space-y-4">
      {contextLabel && (
        <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded p-3">
          <p className="text-[10px] text-slate-500">この通知についてのご意見・ご報告</p>
          <p className="text-sm font-medium mt-0.5">{contextLabel}</p>
        </div>
      )}
      {topicLabel && (
        <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded p-3">
          <p className="text-[10px] text-slate-500">相談したいこと</p>
          <p className="text-sm font-medium mt-0.5">{topicLabel}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            考えていることを、そのままの言葉で書いてください。運営が文を整えて、あなたの名前で提案として載せることもできます。
          </p>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">種別</label>
        <div className="flex flex-col gap-1">
          {CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="category"
                value={c.value}
                checked={category === c.value}
                onChange={() => setCategory(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">内容</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder={PLACEHOLDER[category]}
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <p className="text-[10px] text-slate-400 text-right">{description.trim().length} / 2000 字</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          該当ページのURL（わかれば）
        </label>
        <input
          type="text"
          value={pageUrl}
          onChange={(e) => setPageUrl(e.target.value)}
          placeholder="https://..."
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </div>

      {!isLoggedIn && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">お名前（任意）</label>
            <input
              type="text"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              返信用メールアドレス（任意）
            </label>
            <input
              type="email"
              value={reporterEmail}
              onChange={(e) => setReporterEmail(e.target.value)}
              placeholder="返信が必要な場合のみ入力してください"
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
        </>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={pending || description.trim().length < 1}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                const r = await submitBugReport({
                  source,
                  category,
                  // どの通知・どの話題についての連絡かを運営側で分かるように先頭へ付ける
                  description: contextLabel
                    ? `【通知「${contextLabel}」について】\n${description}`
                    : topicLabel
                      ? `【${topicLabel}について】\n${description}`
                      : description,
                  pageUrl: pageUrl.trim() || undefined,
                  reporterEmail: reporterEmail.trim() || undefined,
                  reporterName: reporterName.trim() || undefined,
                })
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
