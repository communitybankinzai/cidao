'use client'

// FreeFree 掲載の動画（1本）。YouTube のリンクを貼るか、20MB までの動画ファイルをアップロードする。
// 無料枠（容量・転送量）を守るため、長い動画は YouTube のリンクをお願いする。
// 選んだ動画の URL は <input type="hidden" name="video"> で送る（保存前の検査は actions.ts でも行う）。
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FilePickButton } from '@/components/ui/file-pick-button'
import {
  checkVideoFile,
  FREEFREE_VIDEO_BUCKET,
  MAX_VIDEO_BYTES,
  VIDEO_ACCEPT,
  videoStoragePath,
  youtubeEmbedUrl,
  youtubeIdOf,
} from '@/lib/freefree-video'

const PATH_PREFIX = 'pending' // 投稿確定前は pending/<userId>/<random>.<ext>
const MAX_MB = Math.floor(MAX_VIDEO_BYTES / 1024 / 1024)

// initial: 編集画面で、いま掲載に付いている動画
export default function FreefreeVideoInput({ userId, initial = null }: { userId: string; initial?: string | null }) {
  const [url, setUrl] = useState<string | null>(initial)
  const [link, setLink] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // この画面でアップロードした動画だけ、外したときに Storage からも消す。
  // 保存済みの動画は、保存せずに画面を閉じても壊れないよう、掲載から外すだけにする
  const uploadedHere = useRef<Set<string>>(new Set())

  function addLink() {
    setError(null)
    if (!youtubeIdOf(link)) {
      setError('YouTube のリンクを入れてください（https://youtu.be/… など）')
      return
    }
    setUrl(link.trim())
    setLink('')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setError(null)
    const problem = checkVideoFile(file)
    if (problem) {
      setError(problem)
      return
    }
    try {
      setUploading(true)
      const supabase = createClient()
      const ext = file.type === 'video/webm' ? 'webm' : 'mp4'
      const rand = Math.random().toString(36).slice(2, 10)
      const path = `${PATH_PREFIX}/${userId}/${Date.now()}-${rand}.${ext}`
      const { error: upErr } = await supabase.storage
        .from(FREEFREE_VIDEO_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from(FREEFREE_VIDEO_BUCKET).getPublicUrl(path)
      uploadedHere.current.add(pub.publicUrl)
      setUrl(pub.publicUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    const current = url
    setUrl(null)
    if (!current || !uploadedHere.current.has(current)) return
    uploadedHere.current.delete(current)
    try {
      const path = videoStoragePath(current)
      if (path) await createClient().storage.from(FREEFREE_VIDEO_BUCKET).remove([path])
    } catch { /* best effort */ }
  }

  const embed = url ? youtubeEmbedUrl(url) : null

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">動画（1本まで・任意）</label>

      {url && (
        <div className="space-y-1">
          {embed ? (
            <iframe
              src={embed}
              title="YouTube の動画"
              className="w-full aspect-video rounded border border-slate-200 dark:border-slate-700"
              allow="encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <video src={url} controls playsInline preload="metadata" className="w-full max-h-72 rounded border border-slate-200 dark:border-slate-700 bg-black" />
          )}
          <button type="button" onClick={handleRemove} className="text-xs text-red-600 hover:underline">
            この動画を外す
          </button>
          <input type="hidden" name="video" value={url} />
        </div>
      )}

      {!url && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addLink() }
              }}
              placeholder="YouTube のリンク（https://youtu.be/…）"
              inputMode="url"
              className="flex-1 min-w-0 rounded border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            />
            <button type="button" onClick={addLink} className="shrink-0 rounded border border-sky-700 px-3 py-2 text-sm text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950">
              追加
            </button>
          </div>
          <FilePickButton
            ref={inputRef}
            label="🎬 動画ファイルを追加"
            accept={VIDEO_ACCEPT}
            onChange={handleFile}
            disabled={uploading}
          />
          {uploading && <p className="text-xs text-slate-500">アップロード中…（そのままお待ちください）</p>}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">
        MP4・WebM で {MAX_MB}MB まで。長い動画は YouTube のリンクにしてください（サイトの容量を守るため）。SNS の紹介投稿は、これまでどおり画像で出ます
      </p>
    </div>
  )
}
