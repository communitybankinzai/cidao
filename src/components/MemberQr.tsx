'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * ホームの会員証の「会員QR」。タップすると大きく表示する（受付で読み取ってもらうため）。
 *
 * - QR は必ず白地・暗いモジュール（反転は読めない端末がある）。拡大時も白い枠で余白（クワイエットゾーン）を取る
 * - 拡大の画像は粗くならないよう、元の画像を大きめ（600px）で作ってある。拡大時は image-rendering: pixelated で
 *   QR のマス目をくっきり見せる
 * - 閉じ方：「閉じる」ボタン／背景をタップ／Esc。開いている間は背面のスクロールを止める
 * - data-instant="true"：ButtonFeedback が押したボタンを6秒間「処理中」にして押せなくするのを避ける（付けないと、閉じたあと6秒間もう一度開けない）
 */
export function MemberQr({ src, name }: { src: string; name: string }) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        data-instant="true"
        onClick={() => setOpen(true)}
        aria-label="会員QRを大きく表示する"
        className="shrink-0 rounded-lg p-1 text-center transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="会員識別QRコード（プロフィールページへのリンク）"
          width={96}
          height={96}
          className="rounded border border-slate-200 dark:border-slate-700"
        />
        <span className="mt-1 block text-[9px] text-slate-400">会員QR</span>
        <span className="block text-[10px] font-semibold text-sky-700 underline dark:text-sky-300">タップで拡大</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="会員QR（拡大）"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-black/75 p-6"
          onClick={() => setOpen(false)}
        >
          <div className="rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="会員識別QRコード（拡大）"
              className="block aspect-square w-[min(72vw,360px)]"
              style={{ imageRendering: 'pixelated' }}
            />
            <p className="mt-3 max-w-[min(72vw,360px)] break-words text-center text-xl font-bold leading-tight text-slate-900">
              {name}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-instant="true"
            onClick={() => setOpen(false)}
            className="min-h-12 rounded-full bg-white px-8 text-base font-semibold text-slate-900 shadow-lg"
          >
            閉じる
          </button>
        </div>
      )}
    </>
  )
}
