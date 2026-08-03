'use client'

import { useState, useTransition } from 'react'
import { extendVoting } from '../../actions'
import { Button } from '@/components/ui/button'

/**
 * 運営（管理者）だけに表示される投票期間の延長／再開フォーム。
 * isReopen=true は諮問で集計済（closed）の提案を投票中に戻すケース。
 */
export function ExtendVotingForm({
  proposalId,
  isReopen,
  minDate,
}: {
  proposalId: string
  isReopen: boolean
  minDate: string
}) {
  const [date, setDate] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setMessage(null)
    startTransition(async () => {
      const res = await extendVoting(proposalId, date)
      if (res.ok) {
        setDone(true)
        setMessage(isReopen ? '投票を再開しました' : '締切を延長しました')
      } else {
        setMessage(res.error)
      }
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-4 space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        運営メニュー：投票期間の{isReopen ? '再開' : '延長'}
      </h2>
      <p className="text-xs text-slate-500">
        {isReopen
          ? '集計済（諮問）の提案を投票中に戻し、新しい締切を設定します。'
          : '投票中の締切を後ろに延ばします。'}
        指定した日の 23:59（日本時間）が新しい締切になります。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          min={minDate}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <Button size="sm" onClick={submit} disabled={pending || done || !date}>
          {pending ? '処理中…' : isReopen ? '投票を再開する' : '締切を延長する'}
        </Button>
      </div>
      {message && (
        <p className={`text-xs ${done ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
          {message}
        </p>
      )}
    </section>
  )
}
