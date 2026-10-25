'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

// 展示（スクリーンへの投影）用：iPhone の本体（枠・ダイナミックアイランド・ホームバー）だけを模擬して描き、
// 中には「本物の CiDAO」を同じサイトの iframe で表示する。
// 同じサイトの中なので、このブラウザのログインがそのまま使える（別サイトの iframe ではログインが引き継がれない）。
// 画面の論理サイズは iPhone 14 と同じ 390x844。画面の高さに合わせて枠ごと拡大縮小する。
const SCREEN_W = 390
const SCREEN_H = 844
const BEZEL = 14
const MARGIN = 36
const STATUS_H = 47 // ステータスバー（ホーム画面アプリで開いたときの上の帯）の高さ

function scrollbarWidth() {
  const d = document.createElement('div')
  d.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll'
  document.body.appendChild(d)
  const w = d.offsetWidth - d.clientWidth
  document.body.removeChild(d)
  return w
}

// アドレス欄の入力を、iframe に出してよい形にそろえる（2026-10-25：CiDAO 以外のURLも見られるように）。
// '/…' は CiDAO の中のページ（同じサイト・ログインが引き継がれる）。'https://…' や 'example.com' は他のサイト。
// javascript: などは、この管理画面の中で実行されてしまうので受け付けない（http／https だけ）
function normalizeUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return '/'
  if (t.startsWith('/') && !t.startsWith('//')) return t
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

type RoundRectContext = CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }

// 角丸の枠で切り抜く（スマホの丸い角の外は透明にする）
function clipRoundRect(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  const c = ctx as RoundRectContext
  ctx.beginPath()
  if (typeof c.roundRect === 'function') c.roundRect(0, 0, w, h, r)
  else {
    ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath()
  }
  ctx.clip()
}

export function PhoneFrame() {
  const [pc, setPc] = useState(false)
  const [scale, setScale] = useState(1)
  const [sb, setSb] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [clock, setClock] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const deviceRef = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState('/')            // iframe に出すページ。'/' は CiDAO のトップ
  const [urlInput, setUrlInput] = useState('/')
  const [note, setNote] = useState('')           // 画像保存などの結果の知らせ
  const [capturing, setCapturing] = useState(false) // 撮影中は操作ボタンを隠す

  useEffect(() => {
    const fit = () => {
      setScale(Math.min(
        window.innerHeight / (SCREEN_H + BEZEL * 2 + MARGIN),
        window.innerWidth / (SCREEN_W + BEZEL * 2 + MARGIN),
      ))
    }
    const onResize = () => fit()
    const tick = () => setClock(new Date().toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit', hour12: false }))
    const t = window.setTimeout(() => { setSb(scrollbarWidth()); fit(); tick() }, 0)
    const c = window.setInterval(tick, 20000)
    window.addEventListener('resize', onResize)
    return () => { window.clearTimeout(t); window.clearInterval(c); window.removeEventListener('resize', onResize) }
  }, [])

  function goHome() {
    setSrc('/')
    setUrlInput('/')
    setNonce((n) => n + 1)
    setNote('')
  }

  function openUrl(e: FormEvent) {
    e.preventDefault()
    const u = normalizeUrl(urlInput)
    if (!u) { setNote('URLの形が正しくありません（https://… か、CiDAO内のページは / から）'); return }
    setSrc(u)
    setUrlInput(u)
    setNonce((n) => n + 1)
    setNote(u.startsWith('/') ? '' : '表示されないサイトは、相手側が埋め込みを禁止しています（「別タブで開く」を使ってください）')
  }

  // スマホ部分だけを画像（PNG）で保存する。中に映っている画面も含める。
  // 他サイトの iframe の中身は、安全のためページの中からは読み取れない。そこで「このタブ」の画面共有で1コマ撮り、
  // スマホの枠の位置で切り出す（枠の外は透明）。共有の許可の画面が出るので「このタブ」を選ぶ（Edge／Chrome）
  async function savePhoneImage() {
    const el = deviceRef.current
    if (pc || !el) { setNote('画像で保存できるのは「スマホ表示」のときです'); return }
    const media = navigator.mediaDevices
    if (!media || typeof media.getDisplayMedia !== 'function') {
      setNote('このブラウザは画面の取り込みに対応していません（Edge／Chrome の最新版で開いてください）')
      return
    }
    let stream: MediaStream | null = null
    try {
      setNote('共有の画面が出たら「このタブ」を選んで共有してください')
      const options = { video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' } as unknown as DisplayMediaStreamOptions
      stream = await media.getDisplayMedia(options)
      const track = stream.getVideoTracks()[0]
      const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
      if (surface && surface !== 'browser') { setNote('共有は「タブ」の「このタブ」を選んでください（画面全体やウィンドウでは切り出せません）'); return }
      setCapturing(true)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(r, 250)))) // 操作ボタンが消えるのを待つ
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = stream
      await video.play()
      await new Promise<void>((r) => window.setTimeout(r, 200))
      const kx = video.videoWidth / window.innerWidth
      const ky = video.videoHeight / window.innerHeight
      const rect = el.getBoundingClientRect() // 拡大縮小したあとの、枠（ベゼル）を含む外形
      const pad = 8 * scale                   // 外側の輪（影の線）までを含める
      const sx = (rect.left - pad) * kx
      const sy = (rect.top - pad) * ky
      const sw = (rect.width + pad * 2) * kx
      const sh = (rect.height + pad * 2) * ky
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(sw)
      canvas.height = Math.round(sh)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画像を作れませんでした')
      clipRoundRect(ctx, canvas.width, canvas.height, (62 * scale + pad) * kx)
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) throw new Error('画像を作れませんでした')
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      const name = `phone-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      setNote(`保存しました：${name}（${canvas.width}×${canvas.height}px）`)
    } catch (e) {
      const err = e as { name?: string; message?: string }
      setNote(err?.name === 'NotAllowedError' ? '共有がキャンセルされました（画像は保存していません）' : `保存できませんでした：${err?.message ?? '不明なエラー'}`)
    } finally {
      stream?.getTracks().forEach((t) => t.stop())
      setCapturing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-[#0b1220] text-slate-100 overflow-hidden">
      {pc ? (
        <iframe key={`pc-${nonce}`} ref={frameRef} src={src} title="表示中のページ" className="absolute inset-0 h-full w-full border-0 bg-white" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={deviceRef}
            style={{
              width: SCREEN_W + BEZEL * 2,
              height: SCREEN_H + BEZEL * 2,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              borderRadius: 62,
              padding: BEZEL,
              background: '#0a0a0c',
              boxShadow: '0 0 0 3px #3b4558, 0 0 0 7px #151a24, 0 24px 70px rgba(0,0,0,.65)',
              position: 'relative',
            }}
          >
            {/* 画面（角丸で切り抜く。PC用スクロールバーは枠の外へはみ出させて隠す） */}
            <div style={{ position: 'relative', width: SCREEN_W, height: SCREEN_H, borderRadius: 48, overflow: 'hidden', background: '#fff' }}>
              {/* ステータスバー（時刻は実際の時刻。ほかは見た目だけ） */}
              <div style={{ height: STATUS_H, background: '#f8fafc', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 30px 8px 34px', boxSizing: 'border-box', color: '#111', fontWeight: 600, fontSize: 16 }}>
                <span>{clock}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} aria-hidden>
                  <svg width="18" height="12" viewBox="0 0 18 12" fill="#111"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
                  <svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round"><path d="M1.5 4.2a10 10 0 0 1 14 0" /><path d="M4 7a6.4 6.4 0 0 1 9 0" /><circle cx="8.5" cy="10" r="1" fill="#111" stroke="none" /></svg>
                  <svg width="26" height="12" viewBox="0 0 26 12"><rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="#111" opacity=".5" /><rect x="2" y="2" width="19" height="8" rx="2.2" fill="#111" /><rect x="24" y="4" width="2" height="4" rx="1" fill="#111" opacity=".5" /></svg>
                </span>
              </div>
              <iframe
                key={`phone-${nonce}`}
                ref={frameRef}
                src={src}
                title="表示中のページ"
                style={{ width: SCREEN_W + sb, height: SCREEN_H - STATUS_H, border: 0, display: 'block', background: '#fff' }}
              />
              {/* ダイナミックアイランド */}
              <div style={{ position: 'absolute', top: 11, left: '50%', width: 120, height: 34, marginLeft: -60, borderRadius: 17, background: '#000', pointerEvents: 'none' }} />
              {/* ホームバー */}
              <div style={{ position: 'absolute', bottom: 8, left: '50%', width: 134, height: 5, marginLeft: -67, borderRadius: 3, background: 'rgba(0,0,0,.75)', pointerEvents: 'none' }} />
            </div>
            {/* 側面のボタン（見た目だけ） */}
            <div style={{ position: 'absolute', left: -9, top: 150, width: 4, height: 34, borderRadius: 2, background: '#3b4558' }} />
            <div style={{ position: 'absolute', left: -9, top: 210, width: 4, height: 62, borderRadius: 2, background: '#3b4558' }} />
            <div style={{ position: 'absolute', left: -9, top: 285, width: 4, height: 62, borderRadius: 2, background: '#3b4558' }} />
            <div style={{ position: 'absolute', right: -9, top: 230, width: 4, height: 96, borderRadius: 2, background: '#3b4558' }} />
          </div>
        </div>
      )}

      {/* 操作欄（ふだんは薄く、近づくと濃くなる）。撮影中は隠す */}
      <div
        className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-2 opacity-30 transition-opacity hover:opacity-100 focus-within:opacity-100"
        style={{ visibility: capturing ? 'hidden' : 'visible' }}
      >
        <form onSubmit={openUrl} className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            aria-label="表示するページのURL"
            placeholder="/（CiDAO）または https://…"
            spellCheck={false}
            className="w-64 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button type="submit" className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">表示</button>
        </form>
        <button type="button" onClick={() => setPc((v) => !v)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">
          {pc ? 'スマホ表示' : 'PC表示'}
        </button>
        <button type="button" onClick={goHome} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">最初へ</button>
        <button type="button" onClick={() => setNonce((n) => n + 1)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">再読込</button>
        <button type="button" onClick={() => window.open(src, '_blank', 'noopener')} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">別タブで開く</button>
        <button type="button" onClick={savePhoneImage} className="rounded-lg border border-blue-500 bg-blue-700 px-3 py-2 text-sm font-semibold hover:bg-blue-600">画像で保存</button>
      </div>
      {note && !capturing && (
        <div role="status" className="absolute right-3 top-16 z-10 max-w-sm rounded-lg border border-slate-600 bg-slate-800/95 px-3 py-2 text-xs text-slate-100">{note}</div>
      )}
    </div>
  )
}
