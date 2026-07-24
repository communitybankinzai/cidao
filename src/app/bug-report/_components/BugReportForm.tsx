'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { submitBugReport } from '../actions'

const CATEGORIES = [
  { value: 'bug', label: '不具合（動かない・表示がおかしい）' },
  { value: 'feature_request', label: '要望（こうしてほしい）' },
  { value: 'other', label: 'その他' },
] as const

export function BugReportForm({
  source,
  isLoggedIn,
  defaultEmail,
}: {
  source: 'cbi_site' | 'cidao_app'
  isLoggedIn: boolean
  defaultEmail: string
}) {
  const [category, setCategory] = useState<'bug' | 'feature_request' | 'other'>('bug')
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState(defaultEmail)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; emailSent: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (result) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded text-sm space-y-2">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">✓ 報告を送信しました</p>
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          ご協力ありがとうございます。運営が確認のうえ対応します。
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
          もう一件報告する
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-lg p-4 space-y-4">
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
          placeholder="例: スマホでログインボタンを押すと画面が白くなって何も表示されません。機種はiPhone、ブラウザはSafariです。"
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
                  description,
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
