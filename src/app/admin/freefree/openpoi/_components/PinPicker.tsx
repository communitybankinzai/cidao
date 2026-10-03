'use client'

// 地図をクリックしてピンの位置を決める（国土地理院の標準地図タイルだけで動く簡易地図）。
// ・ドラッグで動かす／クリックでピンを置く／＋−で拡大縮小
// ・地図ライブラリは使わない（タイルを並べて、Webメルカトルで位置を換算する）
// ・出典：地理院タイル（国土地理院）

import { useRef, useState } from 'react'

const W = 520
const H = 360
const TILE = 256
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
const INZAI_CENTER = { lat: 35.832, lon: 140.146 }

function worldPx(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z
  const x = ((lon + 180) / 360) * n
  const s = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n
  return { x, y }
}
function fromWorldPx(x: number, y: number, z: number) {
  const n = TILE * 2 ** z
  const lon = (x / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  return { lat, lon }
}

export default function PinPicker({
  lat,
  lon,
  busy,
  onSave,
}: {
  lat: number | null
  lon: number | null
  busy: boolean
  onSave: (lat: number, lon: number) => void
}) {
  const start = lat != null && lon != null ? { lat, lon } : INZAI_CENTER
  const [z, setZ] = useState(17)
  const [center, setCenter] = useState(start)
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(lat != null && lon != null ? { lat, lon } : null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)

  const c = worldPx(center.lat, center.lon, z)
  const left = c.x - W / 2
  const top = c.y - H / 2
  const tx0 = Math.floor(left / TILE)
  const ty0 = Math.floor(top / TILE)
  const tx1 = Math.floor((left + W) / TILE)
  const ty1 = Math.floor((top + H) / TILE)
  const max = 2 ** z
  const tiles: { key: string; x: number; y: number; src: string }[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (ty < 0 || ty >= max) continue
      const wx = ((tx % max) + max) % max
      tiles.push({
        key: `${z}/${tx}/${ty}`,
        x: tx * TILE - left,
        y: ty * TILE - top,
        src: TILE_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty)),
      })
    }
  }
  const pinPx = pin ? worldPx(pin.lat, pin.lon, z) : null
  const changed = pin && (lat == null || lon == null || Math.abs(pin.lat - lat) > 1e-7 || Math.abs(pin.lon - lon) > 1e-7)

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, moved: false }
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    setCenter(fromWorldPx(d.cx - dx, d.cy - dy, z))
  }
  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    setPin(fromWorldPx(left + px, top + py, z))
  }

  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded border bg-slate-200 touch-none select-none cursor-crosshair"
        style={{ width: '100%', maxWidth: W, height: H }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="application"
        aria-label="地図。クリックでピンを置きます"
      >
        <div className="absolute inset-0" style={{ width: W, height: H }}>
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={t.key} src={t.src} alt="" width={TILE} height={TILE} draggable={false} className="absolute max-w-none" style={{ left: t.x, top: t.y }} />
          ))}
          {pinPx && (
            <div className="absolute pointer-events-none" style={{ left: pinPx.x - left - 12, top: pinPx.y - top - 32 }}>
              <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden="true">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#dc2626" stroke="#fff" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="4.5" fill="#fff" />
              </svg>
            </div>
          )}
        </div>
        <div className="absolute right-2 top-2 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <button type="button" className="h-8 w-8 rounded bg-white/90 border text-lg leading-none" onClick={() => setZ((v) => Math.min(18, v + 1))} aria-label="拡大">＋</button>
          <button type="button" className="h-8 w-8 rounded bg-white/90 border text-lg leading-none" onClick={() => setZ((v) => Math.max(14, v - 1))} aria-label="縮小">−</button>
        </div>
        <p className="absolute bottom-0 left-0 right-0 bg-white/80 text-[10px] px-1.5 py-0.5 pointer-events-none">地図：地理院タイル（国土地理院）</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-600">{pin ? `ピン：${pin.lat.toFixed(6)}, ${pin.lon.toFixed(6)}` : '地図をクリックしてピンを置いてください'}</span>
        {pin && (
          <button type="button" className="underline" onClick={() => setCenter(pin)}>ピンの場所へ戻る</button>
        )}
        <button
          type="button"
          disabled={!changed || busy}
          onClick={() => pin && onSave(pin.lat, pin.lon)}
          className="ml-auto rounded bg-slate-900 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? '保存中…' : 'この位置に直す'}
        </button>
      </div>
    </div>
  )
}
