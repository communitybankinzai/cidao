'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/avatar'
import { resizeImageToSquare } from '@/lib/image-resize'

const INPUT_MAX_BYTES = 20 * 1024 * 1024 // 20MB（変換前の上限）

type Stage = 'idle' | 'processing' | 'uploading' | 'saving' | 'done'

export default function AvatarUpload({
  userId,
  initialUrl,
  displayName,
}: {
  userId: string
  initialUrl: string | null
  displayName: string
}) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const previewRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const lastFileRef = useRef<File | null>(null)
  const dragDepth = useRef(0) // ネストした dragleave 対策

  // プレビュー用 ObjectURL のクリーンアップ
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  // クリップボード貼り付け（dropzone にフォーカスがあるとき）
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) {
            e.preventDefault()
            void processFile(f)
            return
          }
        }
      }
    }
    el.addEventListener('paste', handlePaste)
    return () => el.removeEventListener('paste', handlePaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = stage !== 'idle' && stage !== 'done'

  function stageLabel(): string {
    switch (stage) {
      case 'processing': return '画像を処理中…'
      case 'uploading': return 'アップロード中…'
      case 'saving': return '保存中…'
      case 'done': return '✓ 完了'
      default: return url ? '画像を変更' : '画像をアップロード'
    }
  }

  async function processFile(file: File) {
    setError(null)
    setInfo(null)
    lastFileRef.current = file

    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください')
      return
    }
    if (file.size > INPUT_MAX_BYTES) {
      setError('画像が大きすぎます（20MB 以下にしてください）')
      return
    }

    try {
      setStage('processing')

      const resized = await resizeImageToSquare(file, { size: 256, quality: 0.85 })

      const localUrl = URL.createObjectURL(resized.blob)
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      previewRef.current = localUrl
      setPreviewUrl(localUrl)

      setStage('uploading')
      const supabase = createClient()
      const path = `${userId}.${resized.extension}`
      const contentType = resized.extension === 'webp' ? 'image/webp' : 'image/jpeg'

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, resized.blob, { upsert: true, contentType, cacheControl: '60' })
      if (upErr) throw upErr

      // 旧拡張子のファイルは消す（ブラウザが旧バージョンをキャッシュ表示するのを防ぐ）
      const others = ['webp', 'jpg', 'png', 'gif', 'jpeg'].filter((x) => x !== resized.extension)
      await supabase.storage.from('avatars').remove(others.map((x) => `${userId}.${x}`))

      setStage('saving')
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const busted = `${pub.publicUrl}?v=${Date.now()}`

      const { error: updErr } = await supabase
        .from('members')
        .update({ avatar_url: busted })
        .eq('id', userId)
      if (updErr) throw updErr

      setUrl(busted)
      setInfo(
        `${kb(resized.originalBytes)} → ${kb(resized.outputBytes)} (${resized.width}×${resized.height} ${resized.extension.toUpperCase()})`,
      )
      setStage('done')
      window.setTimeout(() => setStage((s) => (s === 'done' ? 'idle' : s)), 1500)
      lastFileRef.current = null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`失敗しました: ${msg}`)
      setStage('idle')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
  }

  async function handleRetry() {
    if (lastFileRef.current) await processFile(lastFileRef.current)
  }

  async function handleRemove() {
    if (!confirm('プロフィール画像を削除しますか？')) return
    setStage('saving')
    setError(null)
    setInfo(null)
    try {
      const supabase = createClient()
      const { error: updErr } = await supabase
        .from('members')
        .update({ avatar_url: null })
        .eq('id', userId)
      if (updErr) throw updErr
      await supabase.storage.from('avatars').remove(
        ['webp', 'jpg', 'png', 'gif', 'jpeg'].map((x) => `${userId}.${x}`),
      )
      setUrl(null)
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current)
        previewRef.current = null
      }
      setPreviewUrl(null)
      lastFileRef.current = null
      setStage('idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`削除に失敗しました: ${msg}`)
      setStage('idle')
    }
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault()
    if (busy) return
    dragDepth.current += 1
    setDragOver(true)
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!busy) e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }

  const display = previewUrl ?? url

  return (
    <div
      ref={dropRef}
      tabIndex={0}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        'flex items-start gap-4 p-3 -m-3 rounded-lg border-2 transition outline-none ' +
        (dragOver
          ? 'border-dashed border-sky-400 bg-sky-50 dark:bg-sky-950/40'
          : 'border-transparent focus:border-slate-300 dark:focus:border-slate-600')
      }
      aria-label="プロフィール画像のアップロード領域。ファイルをドロップ、または画像をコピーして貼り付けできます。"
    >
      <div className="relative shrink-0">
        <Avatar src={display} name={displayName} size="xl" />
        {busy && (
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center text-white text-[10px]">
            …
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center cursor-pointer text-sm">
            <span className={
              'px-3 py-1.5 rounded border text-sm ' +
              (busy
                ? 'border-slate-300 bg-slate-100 text-slate-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800'
                : 'border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700')
            }>
              {stageLabel()}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              disabled={busy}
              className="hidden"
            />
          </label>
          {url && !busy && (
            <button
              type="button"
              onClick={handleRemove}
              className="text-xs text-slate-500 hover:text-rose-600 underline"
            >
              削除
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          クリックして選択、または画像をドラッグ&ドロップ／Ctrl+V で貼り付け。自動で 256×256 にリサイズして WebP 変換します。
        </p>
        {info && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{info}</p>}
        {error && (
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-rose-600 flex-1 min-w-0">{error}</p>
            {lastFileRef.current && (
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs px-2 py-1 rounded border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950"
              >
                再試行
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
