'use client'

import { useEffect } from 'react'

/**
 * 画面下から出る共通のシート（ボトムシート）。
 *
 * スマホでは「画面いっぱいに並んだ選択肢」を縦に積むと本文が押し下げられ、
 * 目的のカードに届くまで何画面もスクロールすることになる。
 * 絞り込み・メニューのように「開いたときだけ見えればよいもの」をここへ入れる。
 *
 * - 背景タップ / ESC / ✕ で閉じる
 * - 開いている間は裏の本文をスクロールさせない
 * - 高さは画面の 85% まで。中身が長ければシートの中だけがスクロールする
 * - iPhone のホームバーに隠れないよう safe-area 分の余白を確保する
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** 下端に固定表示する行（「この条件で見る」など）。省略可 */
  footer?: React.ReactNode
}) {
  // ESC で閉じる＋裏面のスクロールを止める
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full sm:max-w-lg sm:mb-6 max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* つまみ（下から出てくる面であることを示す） */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <span aria-hidden className="block w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="px-4 pb-2 flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            data-instant="true"
            className="flex items-center justify-center w-9 h-9 -mr-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>

        {footer && (
          <div
            className="shrink-0 border-t border-slate-200 dark:border-slate-800 px-4 pt-3"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
