'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * 全ページ左上に固定表示する「ホームに戻る」ボタン（通知ベルと対の配置）。
 * トップページ（/）では表示しない。
 *
 * ボタンは fixed で浮いているため、そのままだと各ページ先頭の
 * 「← 一覧に戻る」等がボタンの下に隠れて押せなくなる。
 * 同じ高さの余白を本文の先頭に確保して重なりを防ぐ（通知ベル側にも効く）。
 */
export function HomeButton() {
  const pathname = usePathname()
  if (pathname === '/') return null

  return (
    <>
      <Link
        href="/"
        aria-label="ホームに戻る"
        className="fixed top-3 left-3 z-50 flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 shadow hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm font-medium text-slate-700 dark:text-slate-200"
      >
        <span aria-hidden>🏠</span>
        <span>ホーム</span>
      </Link>
      {/* 固定ボタン（上12px + 高さ40px）の逃げ。本文はこの下から始まる */}
      <div aria-hidden className="h-10 shrink-0" />
    </>
  )
}
