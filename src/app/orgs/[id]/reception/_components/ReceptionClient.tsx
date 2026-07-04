'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import jsQR from 'jsqr'
import { Button } from '@/components/ui/button'
import { receptionCheckin, searchMembersForReception } from '../../../actions'

type EventOption = { id: string; title: string; startAt: string }
type CheckinRow = {
  id: string
  memberName: string
  purpose: string | null
  eventId: string | null
  createdAt: string
}
type Feedback = { kind: 'ok' | 'already' | 'error'; message: string } | null

// 会員証 QR は https://cidao.vercel.app/talent/<uuid> 形式。UUID 単体にも対応。
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
function extractMemberId(text: string): string | null {
  const m = text.match(UUID_RE)
  if (!m) return null
  if (text.includes('/') && !/\/talent\//.test(text)) return null // 別ページのURLは弾く
  return m[0].toLowerCase()
}

export function ReceptionClient({
  orgId,
  events,
  initialCheckins,
}: {
  orgId: string
  events: EventOption[]
  initialCheckins: CheckinRow[]
}) {
  // 受付設定：イベント連動 or 自由な受付名
  const [eventId, setEventId] = useState<string>('')
  const [purpose, setPurpose] = useState<string>('受付')

  const [checkins, setCheckins] = useState<CheckinRow[]>(initialCheckins)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [busy, setBusy] = useState(false)

  // カメラ
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const lastScanRef = useRef<{ id: string; at: number }>({ id: '', at: 0 })
  const busyRef = useRef(false)

  // 手動検索
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ id: string; display_name: string; avatar_url: string | null }>>([])

  const doCheckin = useCallback(
    async (memberId: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const res = await receptionCheckin(orgId, memberId, {
          eventId: eventId || null,
          purpose: eventId ? null : purpose,
        })
        if (!res.ok) {
          setFeedback({ kind: 'error', message: res.error ?? '受付に失敗しました' })
        } else if (res.alreadyCheckedIn) {
          setFeedback({ kind: 'already', message: `${res.memberName} さんは受付済みです` })
        } else {
          setFeedback({ kind: 'ok', message: `${res.memberName} さんを受付しました` })
          setCheckins((prev) => [
            {
              id: `local-${Date.now()}`,
              memberName: res.memberName ?? '匿名',
              purpose: eventId ? null : purpose,
              eventId: eventId || null,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ])
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [orgId, eventId, purpose],
  )

  // QR スキャンループ
  useEffect(() => {
    if (!scanning) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
      } catch {
        setCameraError('カメラを起動できません。ブラウザのカメラ許可を確認するか、下の名前検索で受付してください。')
        setScanning(false)
        return
      }
      const video = videoRef.current
      if (!video || stopped) {
        stream?.getTracks().forEach((t) => t.stop())
        return
      }
      video.srcObject = stream
      await video.play().catch(() => {})

      const tick = () => {
        if (stopped) return
        const canvas = canvasRef.current
        if (video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          const w = video.videoWidth
          const h = video.videoHeight
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx && w > 0 && h > 0) {
            ctx.drawImage(video, 0, 0, w, h)
            const img = ctx.getImageData(0, 0, w, h)
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
            if (code?.data) {
              const memberId = extractMemberId(code.data)
              const now = Date.now()
              // 同じQRの連続読取は4秒間無視（二重受付防止）
              if (memberId && !(lastScanRef.current.id === memberId && now - lastScanRef.current.at < 4000)) {
                lastScanRef.current = { id: memberId, at: now }
                void doCheckin(memberId)
              } else if (!memberId) {
                setFeedback({ kind: 'error', message: 'CiDAO の会員証 QR ではありません' })
              }
            }
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [scanning, doCheckin])

  async function handleSearch(q: string) {
    setQuery(q)
    if (q.trim().length < 1) {
      setResults([])
      return
    }
    try {
      setResults(await searchMembersForReception(orgId, q))
    } catch {
      setResults([])
    }
  }

  const receptionLabel = eventId
    ? events.find((e) => e.id === eventId)?.title ?? 'イベント受付'
    : purpose || '受付'

  return (
    <div className="space-y-5">
      {/* 受付設定 */}
      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">受付の設定</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1" htmlFor="rc-event">イベント（出席＋pt付与）</label>
            <select
              id="rc-event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
            >
              <option value="">（イベントと連動しない）</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {new Date(e.startAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })} {e.title}
                </option>
              ))}
            </select>
          </div>
          {!eventId && (
            <div>
              <label className="block text-xs text-slate-500 mb-1" htmlFor="rc-purpose">受付名（自由入力）</label>
              <input
                id="rc-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={60}
                placeholder="例：総会受付、ボランティア集合"
                className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
              />
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500">現在の受付：<strong>{receptionLabel}</strong></p>
      </section>

      {/* カメラ */}
      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-slate-500">QR スキャン</h2>
          <Button size="sm" variant={scanning ? 'outline' : 'default'} onClick={() => { setCameraError(null); setScanning(!scanning) }}>
            {scanning ? 'カメラを停止' : 'カメラを起動'}
          </Button>
        </div>
        {cameraError && <p className="text-xs text-rose-600">{cameraError}</p>}
        {scanning && (
          <div className="relative rounded-lg overflow-hidden bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="w-full max-h-80 object-contain" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
        {feedback && (
          <p
            role="status"
            className={
              'text-sm px-3 py-2 rounded ' +
              (feedback.kind === 'ok'
                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200'
                : feedback.kind === 'already'
                  ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200'
                  : 'bg-rose-100 dark:bg-rose-950 text-rose-900 dark:text-rose-200')
            }
          >
            {feedback.message}
          </p>
        )}
      </section>

      {/* 手動受付 */}
      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">名前で受付（QR が使えないとき）</h2>
        <input
          type="search"
          value={query}
          onChange={(e) => void handleSearch(e.target.value)}
          placeholder="表示名で検索"
          className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
        />
        {results.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 border rounded">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm truncate">{r.display_name}</span>
                <Button size="sm" disabled={busy} onClick={() => void doCheckin(r.id)}>受付</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 本日の受付履歴 */}
      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">本日の受付（{checkins.length}件）</h2>
        {checkins.length === 0 ? (
          <p className="text-xs text-slate-400">まだ受付はありません</p>
        ) : (
          <ul className="space-y-1">
            {checkins.map((c) => (
              <li key={c.id} className="flex justify-between items-baseline gap-3 text-sm border-l-2 border-emerald-400 pl-3 py-0.5">
                <span className="truncate">
                  {c.memberName}
                  <span className="ml-2 text-[10px] text-slate-400">
                    {c.eventId ? events.find((e) => e.id === c.eventId)?.title ?? 'イベント' : c.purpose}
                  </span>
                </span>
                <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                  {new Date(c.createdAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
