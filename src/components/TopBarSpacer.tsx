'use client'

import { usePathname } from 'next/navigation'

/**
 * 本文の先頭に置く余白。
 *
 * 右上には通知ベル（ログイン時）と管理リンク（管理者のみ）が fixed で浮いており
 * （top-3・高さ40px）、そのままだと各ページ先頭の見出しや「← ホーム」が
 * その下に隠れて押せなくなる。同じ高さを空けて重なりを防ぐ。
 *
 * もとは左上の「ホームに戻る」ボタン（HomeButton）がこの余白も兼ねていたが、
 * 画面下の BottomNav にホームを置いて導線を一本化したため、余白だけを残した。
 * トップページは先頭が大きく空いているので出さない。
 */
export function TopBarSpacer() {
  const pathname = usePathname()
  if (pathname === '/') return null

  return <div aria-hidden className="h-10 shrink-0" />
}
