'use client'

import { useState, useTransition } from 'react'
import { reportAttendance } from '../actions'

// 開催後の参加者数をその場で入れる小さな入力欄（「人数のお願い」ページと、運営の根拠一覧で使う）。
// 空にして保存すると「未報告」に戻る（0人とは別）。入れられる人は DB の権限（can_edit_event）で決まる。
export function AttendanceQuickForm({ eventId, initial, title }: { eventId: string; initial: number | null; title: string }) {
  const [value, setValue] = useState(initial === null ? '' : String(initial))
  const [saved, setSaved] = useState(initial === null ? '' : String(initial))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const raw = value.trim()
    const count = raw === '' ? null : Number(raw)
    start(async () => {
      const r = await reportAttendance(eventId, count)
      if (r.ok) {
        setSaved(raw)
        setMsg({ ok: true, text: count === null ? '未報告に戻しました' : '保存しました' })
      } else {
        setMsg({ ok: false, text: r.error })
      }
    })
  }

  return (
    <form onSubmit={submit} className="inline-flex flex-wrap items-center justify-end gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100000}
        step={1}
        value={value}
        onChange={(e) => { setValue(e.target.value); setMsg(null) }}
        aria-label={`「${title}」の参加者数`}
        placeholder="人数"
        className="w-16 rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums dark:border-slate-700 dark:bg-slate-800"
      />
      <span className="text-xs text-slate-500">人</span>
      <button
        type="submit"
        disabled={pending || value.trim() === saved}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:border-slate-400 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
      >
        {pending ? '保存中…' : '保存'}
      </button>
      {msg && (
        <span role="status" className={`text-[11px] ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
          {msg.text}
        </span>
      )}
    </form>
  )
}
