'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export type ScannedLink = { label: string; url: string }

export type ScannedFromUrl = {
  title?: string
  body?: string
  category?: string
  location?: string | null
  sns_display_name?: string | null
  coupon_content?: string | null
  links?: ScannedLink[]
  sourceUrl?: string
  confidence?: number
}

type Status = 'idle' | 'loading' | 'done' | 'notice'

// サーバー（/api/freefree/scan-url）が返す reason ごとの市民向けメッセージ
const REASON_MESSAGES: Record<string, string> = {
  blocked: 'このURLは読み取れません。http:// または https:// で始まる公開ページのURLをご確認ください。',
  fetch: 'ページを開けませんでした。URLが正しいか、公開されているかご確認ください。',
  empty: 'ページから文章を読み取れませんでした。JavaScriptで表示されるページは読み取れないことがあります。',
  quota: 'AI読み取りが一時的に利用できません。お手数ですが下の項目を手入力してください。',
  busy: 'AIが混み合っています。数分後に再度お試しいただくか、手入力してください。',
  parse: '内容の読み取りに失敗しました。お手数ですが手入力してください。',
  config: 'AI読み取りが利用できない設定になっています。手入力してください。',
  unknown: '読み取りができませんでした。お手数ですが手入力してください。',
}

export default function FreefreeUrlScan({
  onScanned,
  onImageImported,
  imageSlotsLeft,
}: {
  onScanned: (data: ScannedFromUrl) => void
  onImageImported: (publicUrl: string) => void
  imageSlotsLeft: number
}) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [candidates, setCandidates] = useState<string[]>([])
  const [rightsOk, setRightsOk] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [imported, setImported] = useState<string[]>([])

  async function handleScan() {
    const target = url.trim()
    if (!target) return
    setStatus('loading')
    setMessage('ページを読み取っています…')
    setCandidates([])
    try {
      const res = await fetch('/api/freefree/scan-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = (await res.json().catch(() => ({}))) as ScannedFromUrl & {
        ok?: boolean
        reason?: string
        imageCandidates?: string[]
      }

      // 抽出に失敗しても画像候補だけは拾えていることがある
      if (Array.isArray(data.imageCandidates)) setCandidates(data.imageCandidates)

      if (!res.ok || data.ok === false) {
        const reason = data.reason ?? 'unknown'
        setStatus('notice')
        setMessage(REASON_MESSAGES[reason] ?? REASON_MESSAGES.unknown)
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

  async function handleImport(candidate: string) {
    setImporting(candidate)
    try {
      const res = await fetch('/api/freefree/import-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: candidate }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; reason?: string }
      if (!res.ok || !data.ok || !data.url) {
        setMessage(
          data.reason === 'too_large'
            ? 'この画像は大きすぎて取り込めませんでした（5MBまで）。'
            : data.reason === 'unsupported_type'
              ? 'この画像の形式には対応していません（JPEG / PNG / WebP / GIF）。'
              : '画像を取り込めませんでした。',
        )
        setStatus('notice')
        return
      }
      onImageImported(data.url)
      setImported((prev) => [...prev, candidate])
    } finally {
      setImporting(null)
    }
  }

  const remaining = candidates.filter((c) => !imported.includes(c))

  return (
    <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg p-4 space-y-2">
      <p className="text-sm font-medium">🔗 告知ページのURLから自動入力する（任意）</p>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        お店や活動の紹介ページのURLを貼ると、AIが内容を読み取ってタイトル・本文・カテゴリ・場所・リンクを下の欄に入れます。
        読み取った内容はそのまま掲載されるわけではないので、必ずご自身で確認・修正してください。
      </p>

      <div className="flex gap-2">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/event"
          className="flex-1 min-w-0 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
        />
        <Button type="button" variant="outline" disabled={status === 'loading' || !url.trim()} onClick={handleScan}>
          {status === 'loading' ? '読み取り中…' : '読み取る'}
        </Button>
      </div>

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

      {remaining.length > 0 && (
        <div className="pt-2 border-t border-emerald-200 dark:border-emerald-900 space-y-2">
          <p className="text-xs font-medium">ページ内で見つかった画像（{remaining.length}件）</p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={rightsOk}
              onChange={(e) => setRightsOk(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              これらの画像を掲示板に載せてよい（ご自身の画像である、または権利者の許可を得ている）ことを確認しました
              <span className="block text-[11px] text-slate-500">
                他の人が作った写真やチラシを許可なく載せると、著作権の侵害になることがあります。
              </span>
            </span>
          </label>
          <ul className="grid grid-cols-3 gap-2">
            {remaining.map((c) => (
              <li key={c} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c}
                  alt=""
                  className="w-full aspect-square object-cover rounded border border-slate-200 dark:border-slate-700 bg-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full text-[11px]"
                  disabled={!rightsOk || importing !== null || imageSlotsLeft <= 0}
                  onClick={() => handleImport(c)}
                >
                  {importing === c ? '取り込み中…' : imageSlotsLeft <= 0 ? '画像は3枚まで' : 'この画像を使う'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
