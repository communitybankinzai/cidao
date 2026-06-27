'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function SnsActions() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  async function call(path: string, label: string) {
    setMessage(`${label} 実行中…`)
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (!r.ok) {
        setMessage(`❌ ${label} 失敗: ${j.error ?? r.status}`)
        return
      }
      setMessage(`✓ ${label} 成功: ${JSON.stringify(j).slice(0, 300)}`)
      startTransition(() => router.refresh())
    } catch (e) {
      setMessage(`❌ ${label} 例外: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
      <h2 className="text-lg font-semibold">⚙ 手動操作</h2>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => call('/api/sns/rotate', 'ローテーション 1サイクル')} disabled={pending} size="sm">
          🔄 1サイクル実行（候補を pending に追加）
        </Button>
        <Button onClick={() => call('/api/sns/dispatch', '実投稿')} disabled={pending} size="sm" variant="outline">
          📤 pending を実投稿
        </Button>
      </div>
      {message && (
        <pre className="text-xs bg-slate-100 dark:bg-slate-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">{message}</pre>
      )}
    </section>
  )
}
