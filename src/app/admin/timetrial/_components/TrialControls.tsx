'use client'

// タイムトライアル記録の削除・全リセットボタン（確認ダイアログ付き）

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteTrial, resetAllTrials, saveTtEvent } from '../actions'

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

// datetime-local 用（ローカル時刻の yyyy-MM-ddTHH:mm）
function toLocalInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function EventForm({ initialName, initialFrom, initialTo }: { initialName: string; initialFrom: string; initialTo: string }) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [from, setFrom] = useState(toLocalInput(initialFrom))
  const [to, setTo] = useState(toLocalInput(initialTo))
  const [saved, setSaved] = useState(false)
  const router = useRouter()
  const submit = (clear: boolean) => {
    startTransition(async () => {
      const res = await saveTtEvent(clear ? '' : name, from ? new Date(from).toISOString() : '', to ? new Date(to).toISOString() : '')
      if (!res.ok) { alert(`保存に失敗しました: ${res.error}`); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    })
  }
  const input = 'border border-slate-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-950'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block text-xs text-slate-500 mb-1">イベント名（40字まで）</span>
        <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={input + ' w-56'} placeholder="例: 第1回オンライン競技会" />
      </label>
      <label className="text-sm">
        <span className="block text-xs text-slate-500 mb-1">開始</span>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
      </label>
      <label className="text-sm">
        <span className="block text-xs text-slate-500 mb-1">終了</span>
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
      </label>
      <button type="button" disabled={pending} onClick={() => submit(false)}
        className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
        {pending ? '保存中…' : '保存'}
      </button>
      <button type="button" disabled={pending || !initialName} onClick={() => { if (confirm('イベント期間を解除して通常運用に戻します。よろしいですか？')) submit(true) }}
        className="px-3 py-1.5 rounded border border-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
        解除
      </button>
      {saved ? <span className="text-xs text-emerald-600">保存しました</span> : null}
    </div>
  )
}
