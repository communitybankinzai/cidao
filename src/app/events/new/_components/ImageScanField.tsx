'use client'

import { useRef, useState } from 'react'

type Extracted = {
  title?: string
  description?: string
  start_at?: string | null
  end_at?: string | null
  location?: string | null
  online_flag?: boolean
  organizer_name?: string | null
  capacity?: number | null
  fee?: number | null
  confidence?: number
}

type Status = 'idle' | 'loading' | 'done' | 'error'

export function ImageScanField() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  async function handleFile(file: File) {
    setStatus('loading')
    setMessage(`「${file.name}」を AI で読み取り中…`)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch('/api/events/scan', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as Extracted
      const filled = fillForm(data)
      setStatus('done')
      const pct = Math.round((data.confidence ?? 0) * 100)
      setMessage(`読み取り完了（自信度 ${pct}%、${filled}項目に反映）。内容を必ず確認してから登録してください。`)
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : '読み取りに失敗しました')
    }
  }

  function fillForm(d: Extracted): number {
    const form = inputRef.current?.closest('form')
    if (!form) return 0
    let count = 0
    // React 19 のコントロールドコンポーネントは el.value 直書きでは内部状態を更新しない。
    // ネイティブ setter 経由で値を設定し、bubbling change イベントで React onChange を発火させる。
    const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
      const proto = Object.getPrototypeOf(el) as object
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, value)
      else el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const setField = (name: string, value: string | null | undefined) => {
      if (value == null || value === '') return
      const el = form.querySelector(`[name="${name}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null
      if (!el) return
      setNativeValue(el, value)
      count++
    }
    setField('title', d.title)
    setField('description', d.description)
    setField('start_at', d.start_at ?? undefined)
    setField('end_at', d.end_at ?? undefined)
    setField('location', d.location ?? undefined)
    if (d.capacity != null) setField('capacity', String(d.capacity))
    if (d.fee != null) setField('fee', String(d.fee))

    if (d.online_flag) {
      const cb = form.querySelector('[name="online_flag"]') as HTMLInputElement | null
      if (cb) {
        cb.checked = true
        cb.dispatchEvent(new Event('change', { bubbles: true }))
        count++
      }
    }

    if (d.organizer_name) {
      // 既存登録団体に名前一致するものがあれば、その UUID を選択。なければ __external__ にフォールバック。
      const sel = form.querySelector('select[name="organizer_choice"]') as HTMLSelectElement | null
      const target = d.organizer_name.trim()
      let matched = false
      if (sel && target) {
        for (const opt of Array.from(sel.options)) {
          if (opt.value !== '__member__' && opt.value !== '__external__' && opt.text.trim() === target) {
            setNativeValue(sel, opt.value)
            matched = true
            count++
            break
          }
        }
      }
      if (!matched) {
        setField('organizer_choice', '__external__')
        // __external__ 選択時に表示される organizer_name_text は React の次回レンダー後に出現する
        setTimeout(() => {
          const el = form.querySelector('[name="organizer_name_text"]') as HTMLInputElement | null
          if (el) setNativeValue(el, target)
        }, 0)
      }
    }

    return count
  }

  const statusColor =
    status === 'error'
      ? 'text-rose-600 dark:text-rose-400'
      : status === 'done'
      ? 'text-emerald-700 dark:text-emerald-400'
      : status === 'loading'
      ? 'text-slate-600 dark:text-slate-300'
      : 'text-slate-500'

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium flex items-center gap-1">
          <span aria-hidden>📷</span>
          チラシ画像から自動入力（AI）
        </label>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-amber-200 dark:file:bg-amber-800 file:text-amber-900 dark:file:text-amber-100"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
          disabled={status === 'loading'}
        />
      </div>
      {message && <p className={`text-xs ${statusColor}`}>{message}</p>}
      <p className="text-[10px] text-slate-500">
        画像から タイトル / 日時 / 場所 / 主催団体名 などを抽出してフォームに反映します。AI
        の抽出結果には誤りが含まれることがあります。必ず確認・修正してください。
      </p>
    </div>
  )
}
