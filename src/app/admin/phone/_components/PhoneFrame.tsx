'use client'

import { useEffect, useRef, useState } from 'react'

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

export function PhoneFrame() {
  const [pc, setPc] = useState(false)
  const [scale, setScale] = useState(1)
  const [sb, setSb] = useState(0)
  const [nonce, setNonce] = useState(0)
  const [clock, setClock] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)

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
    if (frameRef.current) frameRef.current.src = '/'
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-[#0b1220] text-slate-100 overflow-hidden">
      {pc ? (
        <iframe key={`pc-${nonce}`} ref={frameRef} src="/" title="CiDAO" className="absolute inset-0 h-full w-full border-0 bg-white" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
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
                src="/"
                title="CiDAO"
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

      <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-30 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => setPc((v) => !v)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">
          {pc ? 'スマホ表示' : 'PC表示'}
        </button>
        <button type="button" onClick={goHome} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">最初へ</button>
        <button type="button" onClick={() => setNonce((n) => n + 1)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-blue-600">再読込</button>
      </div>
    </div>
  )
}
