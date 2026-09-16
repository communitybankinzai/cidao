'use client'

// 号外NET から拾ったコスモスパレットの催し候補（status=draft）。運営が「公開」か「見送り」を押す。
// 公開 → status=open で公開イベントに。見送り → status=cancelled（翌日以降の同期で再登場しない）。

import { useState, useTransition } from 'react'
import { dismissCosmosCandidate, publishCosmosCandidate } from '../actions'

export type CosmosCandidateRow = {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string | null
  fee: number | null
  description: string
  proxy_source_url: string | null
  created_at: string
}

const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
const fmtHm = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })

export function CosmosCandidates({ candidates }: { candidates: CosmosCandidateRow[] }) {
  const [rows, setRows] = useState(candidates)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const act = (id: string, kind: 'publish' | 'dismiss') => {
    setBusy(id)
    setMessage(null)
    startTransition(async () => {
      const r = kind === 'publish' ? await publishCosmosCandidate(id) : await dismissCosmosCandidate(id)
      setBusy(null)
      if (!r.ok) {
        setMessage(r.error)
        return
      }
      setRows((prev) => prev.filter((x) => x.id !== id))
      setMessage(kind === 'publish' ? '公開しました（イベント一覧に載ります）' : '見送りにしました（翌日以降も再登場しません）')
    })
  }

  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">確認待ちの候補はありません。</p>
  }

  return (
    <div className="space-y-2">
      {message && <p className="text-xs text-slate-600 dark:text-slate-300">{message}</p>}
      <ul className="space-y-2">
        {rows.map((r) => {
          const assumed = r.description.includes('仮置き')
          return (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {fmt.format(new Date(r.start_at))}〜{fmtHm.format(new Date(r.end_at))}
                    {assumed && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">時間は仮</span>}
                    {' ／ '}{r.location ?? '会場不明'}
                    {' ／ '}{r.fee === null ? '料金不明' : r.fee === 0 ? '無料' : `${r.fee.toLocaleString()}円`}
                  </p>
                  {r.proxy_source_url && (
                    <a href={r.proxy_source_url} target="_blank" rel="noreferrer noopener" className="text-xs text-blue-700 hover:underline dark:text-blue-300">
                      記事を開く ↗
                    </a>
                  )}
                  <a href={`/events/${r.id}/edit`} className="ml-3 text-xs text-slate-500 hover:underline">内容を直してから公開する</a>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, 'publish')}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    公開
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, 'dismiss')}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    見送り
                  </button>
                </div>
              </div>
              <details className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer text-slate-500">登録される本文</summary>
                <pre className="mt-1 whitespace-pre-wrap font-sans">{r.description}</pre>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
