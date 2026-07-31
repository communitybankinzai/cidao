'use client'

// アクセス分析ダッシュボードの「AI 分析」ボタン。
// /api/admin/analytics/analyze を呼び、生成された分析テキストをその場に表示する。

import { useState } from 'react'

export function AnalyzeButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/analytics/analyze', { method: 'POST' })
      const data: { ok?: boolean; analysis?: string; reason?: string } = await res.json()
      if (data.ok && data.analysis) {
        setResult(data.analysis)
      } else {
        setError(
          data.reason === 'quota' ? 'AI 利用枠が不足しています（クレジット・レート制限）。'
          : data.reason === 'config' ? 'AI の設定に問題があります（APIキー）。'
          : data.reason === 'no-data' ? 'まだ分析できるデータがありません。'
          : 'AI 分析に失敗しました。しばらくして再実行してください。',
        )
      }
    } catch {
      setError('通信に失敗しました。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="px-4 py-2 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium hover:opacity-80 disabled:opacity-50 transition"
      >
        {loading ? '分析中…（30秒ほどかかります）' : result ? 'AI 分析を再実行' : 'AI 分析を実行'}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <div className="text-sm whitespace-pre-wrap bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4">
          {result}
        </div>
      )}
    </div>
  )
}
