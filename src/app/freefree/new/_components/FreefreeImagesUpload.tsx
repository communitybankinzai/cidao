'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resizeImagePreserveAspect } from '@/lib/image-resize'

const MAX_IMAGES = 3
const INPUT_MAX_BYTES = 20 * 1024 * 1024
const PATH_PREFIX = 'pending' // 投稿確定前は pending/<userId>/<random>.webp

export default function FreefreeImagesUpload({ userId }: { userId: string }) {
  const [urls, setUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setError(null)

    if (urls.length >= MAX_IMAGES) {
      setError(`画像は最大 ${MAX_IMAGES} 枚までです`)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください')
      return
    }
    if (file.size > INPUT_MAX_BYTES) {
      setError('画像が大きすぎます（20MB 以下）')
      return
    }

    try {
      setUploading(true)
      const resized = await resizeImagePreserveAspect(file, { maxEdge: 1200, quality: 0.82 })
      const supabase = createClient()
      const rand = Math.random().toString(36).slice(2, 10)
      const path = `${PATH_PREFIX}/${userId}/${Date.now()}-${rand}.${resized.extension}`
      const contentType = resized.extension === 'webp' ? 'image/webp' : 'image/jpeg'
      const { error: upErr } = await supabase.storage
        .from('freefree-images')
        .upload(path, resized.blob, { upsert: false, contentType, cacheControl: '300' })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('freefree-images').getPublicUrl(path)
      setUrls((prev) => [...prev, pub.publicUrl])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(index: number) {
    const url = urls[index]
    setUrls((prev) => prev.filter((_, i) => i !== index))
    // Storage からも消す（path は URL の末尾から復元）
    try {
      const m = url.match(/freefree-images\/(.+)$/)
      if (m) {
        const supabase = createClient()
        await supabase.storage.from('freefree-images').remove([m[1]])
      }
    } catch { /* best effort */ }
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">画像（最大 {MAX_IMAGES} 枚）</label>

      {urls.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {urls.map((u, i) => (
            <li key={u} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`画像 ${i + 1}`} className="w-full aspect-square object-cover rounded border border-slate-200 dark:border-slate-700" />
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="absolute top-1 right-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition"
              >
                削除
              </button>
              <input type="hidden" name="images" value={u} />
            </li>
          ))}
        </ul>
      )}

      {urls.length < MAX_IMAGES && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleAdd}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && <p className="text-xs text-slate-500 mt-1">アップロード中…</p>}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">長辺 1200px に自動縮小、WebP/JPEG で保存</p>
    </div>
  )
}
