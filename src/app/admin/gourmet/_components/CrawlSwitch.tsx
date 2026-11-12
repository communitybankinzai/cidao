'use client'

// 食レポの SNS 巡回のスイッチ（緊急停止・再開）。既定オフ。事業主が OK を出すまで有効にしない
import { useState, useTransition } from 'react'
import { setCrawlEnabled } from '../actions'

export function CrawlSwitch({ enabled, dailyLimit }: { enabled: boolean; dailyLimit: number }) {
  const [on, setOn] = useState(enabled)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm">
      <span className="font-semibold">巡回：{on ? '有効（毎朝の同期で読む）' : '停止中'}</span>
      <span className="text-slate-500">AI の読み取りは1日 {dailyLimit} 回まで</span>
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          if (!on && !confirm('食レポの巡回を有効にします。明朝の同期から AI の読み取り（費用あり）が始まります。よろしいですか？')) return
          const r = await setCrawlEnabled(!on)
          if (r.ok) setOn(!on)
          setMsg(r.message)
        })}
        className={`rounded px-3 py-1.5 font-semibold ${on ? 'bg-rose-600 text-white' : 'border border-slate-300 dark:border-slate-700'}`}>
        {on ? '止める' : '有効にする'}
      </button>
      {msg && <span className="text-slate-600 dark:text-slate-300">{msg}</span>}
    </div>
  )
}
