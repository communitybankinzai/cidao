'use client'

// タイムトライアル記録の削除・全リセットボタン（確認ダイアログ付き）

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteTrial, resetAllTrials } from '../actions'

export function DeleteTrialButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`「${name}」の記録を削除します。よろしいですか？`)) return
        startTransition(async () => {
          const res = await deleteTrial(id)
          if (!res.ok) alert(`削除に失敗しました: ${res.error}`)
          router.refresh()
        })
      }}
      className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
    >
      {pending ? '削除中…' : '削除'}
    </button>
  )
}

export function RequirementsForm({ initialRatePct, initialAnswers }: { initialRatePct: number; initialAnswers: number }) {
  const [pending, startTransition] = useTransition()
  const [rate, setRate] = useState(String(initialRatePct))
  const [answers, setAnswers] = useState(String(initialAnswers))
  const [saved, setSaved] = useState(false)
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block text-xs text-slate-500 mb-1">クイズ正答率（%以上）</span>
        <input type="number" min={0} max={100} value={rate} onChange={(e) => { setRate(e.target.value); setSaved(false) }}
          className="w-24 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
      </label>
      <label className="text-sm">
        <span className="block text-xs text-slate-500 mb-1">最低解答数（問以上）</span>
        <input type="number" min={0} max={500} value={answers} onChange={(e) => { setAnswers(e.target.value); setSaved(false) }}
          className="w-24 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const { saveTtRequirements } = await import('../actions')
            const res = await saveTtRequirements(Number(rate), Number(answers))
            if (!res.ok) { alert(`保存に失敗しました: ${res.error}`); return }
            setSaved(true)
            router.refresh()
          })
        }}
        className="text-sm px-4 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? '保存中…' : '保存'}
      </button>
      {saved && <span className="text-sm text-green-600">✅ 保存しました（サイトに即時反映）</span>}
    </div>
  )
}

// 3Dワールドの描画精度。小さいほど鮮明だがタイル取得が増え、Google側の1日上限に早く達する。
// 課金は root リクエスト単位のため、この値を変えても費用は増えない
export function RenderQualityForm({ initialSse }: { initialSse: number }) {
  const [pending, startTransition] = useTransition()
  const [sse, setSse] = useState(String(initialSse))
  const [saved, setSaved] = useState(false)
  const router = useRouter()
  const presets = [
    { v: 4, label: '4（最も鮮明・上限に達しやすい）' },
    { v: 8, label: '8（鮮明・既定）' },
    { v: 16, label: '16（粗め・Cesium標準）' },
    { v: 32, label: '32（かなり粗い・上限に強い）' },
  ]
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block text-xs text-slate-500 mb-1">描画精度（小さいほど鮮明）</span>
        <select
          value={sse}
          onChange={(e) => { setSse(e.target.value); setSaved(false) }}
          className="px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          {presets.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const { saveRenderQuality } = await import('../actions')
            const res = await saveRenderQuality(Number(sse))
            if (!res.ok) { alert(`保存に失敗しました: ${res.error}`); return }
            setSaved(true)
            router.refresh()
          })
        }}
        className="text-sm px-4 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? '保存中…' : '保存'}
      </button>
      {saved && <span className="text-sm text-green-600">✅ 保存しました（開いている画面にも5分以内に反映）</span>}
    </div>
  )
}

export function ResetAllButton({ total }: { total: number }) {
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState('')
  const router = useRouter()
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="「リセット」と入力"
        className="text-sm px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 w-40"
      />
      <button
        type="button"
        disabled={pending || text !== 'リセット'}
        onClick={() => {
          if (!confirm(`全${total}件の記録をすべて削除します。取り消しはできません。よろしいですか？`)) return
          startTransition(async () => {
            const res = await resetAllTrials()
            if (!res.ok) alert(`リセットに失敗しました: ${res.error}`)
            setText('')
            router.refresh()
          })
        }}
        className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
      >
        {pending ? 'リセット中…' : '🗑 全記録をリセット'}
      </button>
    </div>
  )
}
