'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/avatar'
import { resizeImageToSquare } from '@/lib/image-resize'

const INPUT_MAX_BYTES = 20 * 1024 * 1024 // 20MB（変換前の上限）

type Stage = 'idle' | 'processing' | 'uploading' | 'saving' | 'done'

function parseYPercent(pos: string | null | undefined): number {
  if (!pos) return 50
  const m = pos.match(/(\d+(?:\.\d+)?)%\s*$/)
  if (m) return Math.max(0, Math.min(100, parseFloat(m[1])))
  if (/top/.test(pos)) return 0
  if (/bottom/.test(pos)) return 100
  return 50
}

const ZOOM_MIN = 1.0  // 1.0 未満は枠より画像が小さくなって余白が出るため不要
const ZOOM_MAX = 3.0
const ZOOM_STEP = 0.05
function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}

export default function AvatarUpload({
  userId,
  initialUrl,
  initialPosition,
  initialZoom,
  displayName,
}: {
  userId: string
  initialUrl: string | null
  initialPosition: string | null
  initialZoom: number | null
  displayName: string
}) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // 位置調整：画像の縦方向のクロップ位置（0=画像の上端, 100=画像の下端 を円中央に）
  const [yPercent, setYPercent] = useState<number>(parseYPercent(initialPosition))
  const [savedYPercent, setSavedYPercent] = useState<number>(parseYPercent(initialPosition))
  // 拡大率
  const [zoom, setZoom] = useState<number>(clampZoom(initialZoom ?? 1))
  const [savedZoom, setSavedZoom] = useState<number>(clampZoom(initialZoom ?? 1))
  const [posSaving, setPosSaving] = useState(false)
  const [posSaved, setPosSaved] = useState(false)
  const previewBoxRef = useRef<HTMLDivElement>(null)
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
  const objectPosition = `center ${yPercent}%`
  const positionDirty =
    Math.abs(yPercent - savedYPercent) > 0.1 ||
    Math.abs(zoom - savedZoom) > 0.01

  function onPosPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!display) return
    e.preventDefault()
    e.stopPropagation()
    const box = previewBoxRef.current
    if (!box) return
    const h = box.getBoundingClientRect().height || 80
    const startY = e.clientY
    const startYPercent = yPercent
    setPosSaved(false)

    const onMove = (ev: PointerEvent) => {
      const deltaPx = ev.clientY - startY
      const deltaPct = (deltaPx / h) * 100
      // 下にドラッグ → 画像が下に動いて見える（画像内の上側を見せる方向）→ yPercent を減らす
      const next = Math.max(0, Math.min(100, startYPercent - deltaPct))
      setYPercent(next)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  async function savePosition() {
    if (!url || posSaving) return
    setPosSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: updErr } = await supabase
        .from('members')
        .update({
          avatar_position: `center ${yPercent.toFixed(1)}%`,
          avatar_zoom: Number(zoom.toFixed(2)),
        })
        .eq('id', userId)
      if (updErr) throw updErr
      setSavedYPercent(yPercent)
      setSavedZoom(zoom)
      setPosSaved(true)
      window.setTimeout(() => setPosSaved(false), 1800)
    } catch (e) {
      setError(`位置の保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPosSaving(false)
    }
  }

  function resetPosition() {
    setYPercent(50)
    setZoom(1)
  }

  function onPosWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!display) return
    e.preventDefault()
    // 下にホイール = 拡大、上にホイール = 縮小（macOS の自然なスクロール感に近い）
    const dir = e.deltaY > 0 ? 1 : -1
    setZoom((z) => clampZoom(z + dir * ZOOM_STEP * 2))
    setPosSaved(false)
  }

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
        <div
          ref={previewBoxRef}
          onPointerDown={onPosPointerDown}
          onWheel={onPosWheel}
          onDragStart={(e) => e.preventDefault()}
          className={'rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 ' + (display ? 'cursor-grab active:cursor-grabbing' : '')}
          style={{ width: '5rem', height: '5rem', touchAction: 'none' }}
          title={display ? 'ドラッグで位置調整・ホイールで拡大縮小' : ''}
        >
          {display ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={display}
              alt=""
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="w-full h-full object-cover bg-slate-100 dark:bg-slate-800 select-none pointer-events-none"
              style={{
                objectPosition,
                transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                transformOrigin: 'center center',
                userSelect: 'none',
              }}
            />
          ) : (
            <Avatar src={null} name={displayName} size="xl" />
          )}
        </div>
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
        {url && (
          <div className="text-xs space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800 mt-1">
            <p className="text-slate-500">
              <strong>① 拡大スライダーで拡大</strong>（または円の上でマウスホイール）→ <strong>② 円を上下にドラッグ</strong>して見せたい位置を中央に
            </p>
            <p className="text-[10px] text-slate-400">
              現在：拡大 {zoom.toFixed(2)}× / 縦位置 {yPercent.toFixed(0)}%
              {zoom <= 1.001 && (
                <span className="text-amber-600 dark:text-amber-400 ml-2">
                  ※ 拡大が 1.00× のままだと画像が枠ぴったりで上下に動きません
                </span>
              )}
            </p>
            <label className="flex items-center gap-2 text-slate-500">
              <span className="w-12 shrink-0">拡大</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={zoom}
                onChange={(e) => { setZoom(clampZoom(parseFloat(e.target.value))); setPosSaved(false) }}
                className="flex-1"
              />
              <span className="w-12 shrink-0 text-right tabular-nums">{zoom.toFixed(2)}×</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={savePosition}
                disabled={!positionDirty || posSaving}
                className={
                  'text-xs px-2 py-1 rounded border ' +
                  (positionDirty && !posSaving
                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 cursor-not-allowed')
                }
              >
                {posSaving ? '保存中…' : '位置を保存'}
              </button>
              {positionDirty && (
                <button
                  type="button"
                  onClick={() => { setYPercent(savedYPercent); setZoom(savedZoom) }}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                >
                  変更を取り消す
                </button>
              )}
              {(Math.abs(yPercent - 50) > 0.1 || Math.abs(zoom - 1) > 0.01) && !positionDirty && (
                <button
                  type="button"
                  onClick={resetPosition}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                >
                  初期状態に戻す
                </button>
              )}
              {posSaved && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">✓ 保存しました</span>}
            </div>
          </div>
        )}
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
