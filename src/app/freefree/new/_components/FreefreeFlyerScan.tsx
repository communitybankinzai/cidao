'use client'

import { useRef, useState } from 'react'
import { resizeImagePreserveAspect } from '@/lib/image-resize'

export type ScannedFreefree = {
  title?: string
  body?: string
  category?: string
  location?: string | null
  sns_display_name?: string | null
  coupon_content?: string | null
  confidence?: number
}

// notice: AI 抽出が使えなかった等のお知らせ（エラー色ではなくグレー地で表示）
type Status = 'idle' | 'loading' | 'done' | 'notice'

// サーバー（/api/freefree/scan）が返す reason ごとの市民向けメッセージ。
// HTTP ステータス番号は表示しない
const REASON_MESSAGES: Record<string, string> = {
  quota: 'AI読み取りが一時的に利用できません。お手数ですが下の項目を手入力でご登録ください。',
  busy: 'AIが混み合っています。数分後に再度お試しいただくか、手入力でご登録ください。',
  too_large: '画像サイズが大きすぎます。5MB以下に縮小してからお試しください。',
  parse: '画像の読み取りに失敗しました。お手数ですが手入力でご登録ください。',
  config: 'AI読み取りが利用できない設定になっています。手入力でご登録ください。',
  unknown: '画像の読み取りができませんでした。お手数ですが手入力でご登録ください。',
}

export default function FreefreeFlyerScan({
  onScanned,
}: {
  onScanned: (data: ScannedFreefree) => void
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setStatus('loading')
    setMessage(`「${file.name}」をアップロード + AI 読み取り中…`)
    try {
      // Anthropic の画像上限は 5MB。撮ったままの写真は超えることが多いので先に縮小する
      const resized = await resizeImagePreserveAspect(file, { maxEdge: 1600, quality: 0.85 })
      const contentType = resized.extension === 'webp' ? 'image/webp' : 'image/jpeg'
      const fd = new FormData()
      fd.append('image', new File([resized.blob], `scan.${resized.extension}`, { type: contentType }))

      const res = await fetch('/api/freefree/scan', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as ScannedFreefree & {
        ok?: boolean
        reason?: string
        image_url?: string | null
      }

      // 画像アップロード自体は成功している可能性があるので image_url が来ていれば反映
      if (data.image_url) setImageUrl(data.image_url)

      if (!res.ok || data.ok === false) {
        // AI 読み取りは入力補助。失敗してもエラーにせず「お知らせ」として案内し、手入力を促す
        const reason = data.reason ?? (res.status === 413 ? 'too_large' : 'unknown')
        const attached = data.image_url ? '（画像は添付済みです。そのまま掲載できます）' : ''
        setStatus('notice')
        setMessage((REASON_MESSAGES[reason] ?? REASON_MESSAGES.unknown) + attached)
        return
      }

      onScanned(data)
      const low = typeof data.confidence === 'number' && data.confidence < 0.5
      setStatus(low ? 'notice' : 'done')
      setMessage(
        low
          ? '読み取れましたが自信が低めです。内容が合っているか必ずご確認ください。'
          : '読み取りました。内容が合っているかご確認のうえ、必要なら直してください。',
      )
    } catch (err) {
      setStatus('notice')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-lg p-4 space-y-2">
      <p className="text-sm font-medium">📷 チラシや店頭の写真から自動入力する（任意）</p>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        写真を1枚選ぶと、AIが読み取ってタイトル・本文・カテゴリ・場所を下の欄に入れます。
        読み取った内容はそのまま掲載されるわけではないので、必ずご自身で確認・修正してください。
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={status === 'loading'}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (inputRef.current) inputRef.current.value = ''
          if (f) handleFile(f)
        }}
        className="text-sm"
      />
      {message && (
        <p
          className={`text-xs ${
            status === 'done'
              ? 'text-emerald-700 dark:text-emerald-400'
              : status === 'loading'
                ? 'text-slate-500'
                : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {message}
        </p>
      )}
      {imageUrl && (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="読み取った画像" className="w-20 h-20 object-cover rounded border border-slate-200 dark:border-slate-700" />
          <span className="text-xs text-slate-500">この画像は掲載画像として添付されます</span>
          {/* 掲載時の images に含める（FreefreeImagesUpload の hidden input と合流する） */}
          <input type="hidden" name="images" value={imageUrl} />
        </div>
      )}
    </div>
  )
}
