'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// 紹介動画用の写真（2026-09-15）。ブラウザで長辺 2000px の JPEG に縮めてから1枚ずつ送る（通信量と本文の上限のため）。
// 縮めるときに向きを直し、位置情報などの EXIF は落ちる。サーバー側でもう一度縮めて EXIF を落とす。
type Photo = { id: string; url: string | null }
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode')), 'image/jpeg', 0.9))
}
export default function PhotoUploader({ photos }: { photos: Photo[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setError('')
    for (let i = 0; i < files.length; i++) {
      setBusy(`${i + 1}/${files.length} 枚目を送っています…`)
      try {
        const body = new FormData()
        body.append('photo', await shrink(files[i]), 'photo.jpg')
        const res = await fetch('/api/talent-bank/photos', { method: 'POST', body })
        if (!res.ok) { setError((await res.json()).error ?? '送れませんでした。'); break }
      } catch { setError('写真を読めませんでした。別の写真をお試しください。'); break }
    }
    setBusy(''); router.refresh()
  }
  async function remove(photoId: string) {
    if (!confirm('この写真を消しますか？')) return
    setBusy('消しています…')
    const res = await fetch('/api/talent-bank/photos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId }) })
    if (!res.ok) setError((await res.json()).error ?? '消せませんでした。')
    setBusy(''); router.refresh()
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {photos.map(p => <div key={p.id} className="relative h-28 w-20 overflow-hidden rounded-lg border bg-muted">
        {p.url && <img src={p.url} alt="" className="h-full w-full object-cover" />}
        <button type="button" onClick={() => remove(p.id)} disabled={!!busy} aria-label="この写真を消す" className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white">×</button>
      </div>)}
    </div>
    <label className="block text-sm">写真を追加（複数可・12枚まで）
      <input type="file" accept="image/*" multiple disabled={!!busy} onChange={e => { onFiles(e.target.files); e.target.value = '' }} className="mt-2 block w-full text-sm" />
    </label>
    {busy && <p role="status" className="text-sm">{busy}</p>}
    {error && <p role="alert" className="rounded border border-red-500 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950">{error}</p>}
  </div>
}
