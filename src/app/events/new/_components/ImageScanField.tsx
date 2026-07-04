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
  flyer_image_url?: string | null
  confidence?: number
}

type Status = 'idle' | 'loading' | 'done' | 'error'

export function ImageScanField({
  initialFlyerUrl = null,
}: {
  initialFlyerUrl?: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')
  const [flyerUrl, setFlyerUrl] = useState<string | null>(initialFlyerUrl)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    setStatus('loading')
    setMessage(`「${file.name}」をアップロード + AI 読み取り中…`)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch('/api/events/scan', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as Extracted & { error?: string }
      if (!res.ok) {
        // 画像アップロード自体は成功している可能性があるので flyer_image_url が来ていれば反映
        if (data.flyer_image_url) setFlyerUrl(data.flyer_image_url)
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      if (data.flyer_image_url) setFlyerUrl(data.flyer_image_url)
      const filled = fillForm(data)
      setStatus('done')
      const pct = Math.round((data.confidence ?? 0) * 100)
      setMessage(
        `保存完了（自信度 ${pct}%、${filled}項目に反映）。チラシ画像はイベントに添付されました。内容を確認してから登録してください。`,
      )
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : '読み取りに失敗しました')
    }
  }

  function fillForm(d: Extracted): number {
    const form = inputRef.current?.closest('form')
    if (!form) return 0
    let count = 0
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
    // 「（読み取り失敗）」は反映しない（モデルが意図的に返す sentinel）
    if (d.title && d.title !== '（読み取り失敗）') setField('title', d.title)
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
        setTimeout(() => {
          const el = form.querySelector('[name="organizer_name_text"]') as HTMLInputElement | null
          if (el) setNativeValue(el, target)
        }, 0)
      }
    }

    return count
  }

  function clearFlyer() {
    setFlyerUrl(null)
    setMessage('')
    setStatus('idle')
    if (inputRef.current) inputRef.current.value = ''
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
      <input type="hidden" name="flyer_image_url" value={flyerUrl ?? ''} />
      <div
        className={`flex flex-wrap items-center gap-3 rounded border border-dashed p-2 transition-colors ${
          dragOver
            ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40'
            : 'border-transparent'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void handleFile(f)
        }}
      >
        <label className="text-sm font-medium flex items-center gap-1">
          <span aria-hidden>📷</span>
          チラシ画像（アップロード + AI 自動入力、ドラッグ&ドロップ可）
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
        {flyerUrl && (
          <button
            type="button"
            onClick={clearFlyer}
            className="text-xs text-slate-500 hover:text-rose-600 underline"
          >
            画像を外す
          </button>
        )}
      </div>
      {flyerUrl && (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={flyerUrl}
            alt="チラシプレビュー"
            className="max-w-[160px] max-h-[200px] rounded border border-amber-200 dark:border-amber-900 bg-white object-contain"
          />
          <p className="text-[10px] text-slate-500 break-all flex-1">
            添付済み。登録後はイベント詳細ページに大きく表示されます。
          </p>
        </div>
      )}
      {message && <p className={`text-xs ${statusColor}`}>{message}</p>}
      <p className="text-[10px] text-slate-500">
        画像から タイトル / 日時 / 場所 / 主催団体名 などを抽出してフォームに反映します。AI
        の抽出結果には誤りが含まれることがあります。必ず確認・修正してください。
        画像本体は Supabase Storage に保存され、来訪した市民が詳細ページで閲覧できます。
      </p>
    </div>
  )
}
