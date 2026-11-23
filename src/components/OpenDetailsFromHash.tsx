'use client'

import { useEffect } from 'react'

/**
 * URL の #項目名 が <details> を指しているとき、その項目を開いた状態にして見える位置へ動かす。
 * 「くわしく」などのリンクから よくある質問 の1項目へ飛んだとき、もう一度押さなくても答えが読めるようにする（2026-11-23）。
 * ページの中で #項目名 が変わったときも同じように開く
 */
export function OpenDetailsFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (!id) return
      const el = document.getElementById(id)
      if (!(el instanceof HTMLDetailsElement)) return
      el.open = true
      el.scrollIntoView({ block: 'start' })
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])
  return null
}
