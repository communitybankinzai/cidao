'use client'

import { useEffect, useState } from 'react'

type DailyRequestCount = {
  date: string
  requestCount: number
}

type MapTilesUsageResponse =
  | {
      ok: true
      configured: true
      generatedAt: string
      daily: DailyRequestCount[]
      last7Total: number
      previous7Total: number
      weekOverWeekChange: number | null
    }
  | {
      ok: false
      configured?: boolean
      reason?: string
      message?: string
    }

export function MapTilesUsageSection() {
  const [data, setData] = useState<MapTilesUsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/admin/analytics/map-tiles', { cache: 'no-store' })
        const body: unknown = await res.json()
        if (cancelled) return
        if (!isMapTilesUsageResponse(body)) {
          setError('Google Cloud 使用量の取得結果を読み取れませんでした。')
          return
        }
        if (!res.ok && (body.ok || !body.message)) {
          setError('Google Cloud 使用量の取得に失敗しました。')
          return
        }
        setData(body)
      } catch {
        if (!cancelled) setError('Google Cloud 使用量の取得に失敗しました。')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Google Map Tiles API リクエスト数</h2>
          <p className="text-sm text-slate-500">費用ではなく、Cloud Monitoring のリクエスト件数を表示します。</p>
        </div>
        {data?.ok && (
          <p className="text-xs text-slate-500">取得時点: {formatDateTime(data.generatedAt)}</p>
        )}
      </div>

      {!data && !error && (
        <p className="text-sm text-slate-500">Google Cloud 使用量を確認しています…</p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data && !data.ok && (
        <p className={data.configured === false ? 'text-sm text-slate-500' : 'text-sm text-red-600 dark:text-red-400'}>
          {data.configured === false ? 'Google Cloud連携が未設定です' : data.message ?? 'Google Cloud 使用量の取得に失敗しました。'}
        </p>
      )}

      {data?.ok && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500">直近7日</p>
              <p className="text-2xl font-bold text-right tabular-nums">{formatCount(data.last7Total)}</p>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500">前7日</p>
              <p className="text-2xl font-bold text-right tabular-nums">{formatCount(data.previous7Total)}</p>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500">前週比</p>
              <p className="text-2xl font-bold text-right tabular-nums">
                {formatWeekOverWeek(data.weekOverWeekChange, data.last7Total, data.previous7Total)}
              </p>
            </div>
          </div>

          <RequestCountChart rows={data.daily} />

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-3 text-left font-normal">日付</th>
                  <th className="py-2 pl-3 text-right font-normal">リクエスト数</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.slice(-7).reverse().map((row) => (
                  <tr key={row.date} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2 pr-3">{formatDay(row.date)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{formatCount(row.requestCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function RequestCountChart({ rows }: { rows: DailyRequestCount[] }) {
  if (rows.length < 2) {
    return <p className="text-sm text-slate-500">グラフはデータが2日分たまると表示されます。</p>
  }

  const W = 640
  const H = 180
  const PAD = { top: 10, right: 10, bottom: 24, left: 48 }
  const max = Math.max(...rows.map((row) => row.requestCount), 1)
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (rows.length - 1)
  const y = (value: number) => H - PAD.bottom - (value * (H - PAD.top - PAD.bottom)) / max
  const points = rows.map((row, i) => `${x(i)},${y(row.requestCount)}`).join(' ')
  const gridValues = [0, Math.round(max / 2), max]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Google Map Tiles API 日別リクエスト数">
      {gridValues.map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(value)}
            y2={y(value)}
            className="stroke-slate-200 dark:stroke-slate-800"
            strokeWidth="1"
          />
          <text x={PAD.left - 6} y={y(value) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
            {formatCount(value)}
          </text>
        </g>
      ))}
      <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[11px]">
        {formatDay(rows[0].date)}
      </text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[11px]">
        {formatDay(rows[rows.length - 1].date)}
      </text>
      <polyline points={points} fill="none" stroke="#16a34a" strokeWidth="2" />
    </svg>
  )
}

function isMapTilesUsageResponse(value: unknown): value is MapTilesUsageResponse {
  if (!value || typeof value !== 'object') return false
  return 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

function formatWeekOverWeek(change: number | null, current: number, previous: number): string {
  if (change === null) return current === 0 && previous === 0 ? '±0%' : '前週データなし'
  return `${change >= 0 ? '+' : ''}${change.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('ja-JP')
}

function formatDay(date: string): string {
  return date.slice(5).replace('-', '/')
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
