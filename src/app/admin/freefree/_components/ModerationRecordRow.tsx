'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { exportModerationRecord } from '../actions'

export type RecordRow = {
  id: string
  action: string
  createdAt: string
  reason: string | null
  title: string
  posterLabel: string
  evidenceCount: number
  actorName: string | null
}

const ACTION_LABEL: Record<string, string> = {
  hidden: '非公開にした',
  restored: '元に戻した',
  images_deleted: '画像を削除した',
  deleted: '完全に削除した',
}

export default function ModerationRecordRow({ record }: { record: RecordRow }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function download() {
    setError(null)
    startTransition(async () => {
      try {
        const data = await exportModerationRecord(record.id)
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `CiDAO_対応記録_${record.createdAt.slice(0, 10)}_${record.id.slice(0, 8)}.json`
        a.click()
        URL.revokeObjectURL(url)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <li className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-slate-500 shrink-0">
          {new Date(record.createdAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="shrink-0 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {ACTION_LABEL[record.action] ?? record.action}
        </span>
        <span className="flex-1 min-w-0 truncate font-medium text-slate-700 dark:text-slate-300">{record.title}</span>
        {record.evidenceCount > 0 && (
          <span className="shrink-0 text-[10px] text-slate-500">🖼 証拠画像 {record.evidenceCount} 枚</span>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        投稿者: {record.posterLabel}
        {record.actorName && <> ／ 対応: {record.actorName}</>}
        {record.reason && <> ／ 理由: {record.reason}</>}
      </p>
      <div className="flex justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={download}>
          {pending ? '準備中…' : '提出用データをダウンロード'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  )
}
