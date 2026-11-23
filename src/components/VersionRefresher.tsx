'use client'

import { useEffect } from 'react'

/**
 * 開いたままの画面を、新しい版へ自動で切り替える（2026-11-23 事業主決定）。layout.tsx に1つだけ置く。
 *
 * きっかけ：本番に新しい版を出しても、開いたままの画面は古い版のまま残る。
 * ホーム画面に追加したアプリには再読み込みのボタンが無く、会員は新しい版に気づけない。
 *
 * 動き：画面に戻ってきたとき（別のアプリ・タブから戻る、戻る操作で復元される）に、
 * /api/version の番号と、この画面が持っている番号（NEXT_PUBLIC_BUILD_ID）を比べ、違えば読み直す。
 *
 * 読み直さないとき：
 *   ・このページで何か入力した後（書きかけを消さないため。ページを移ると解除）
 *   ・受付の画面（当日の運営中に画面が切り替わると困るため）
 *   ・前に確かめてから5分たっていない
 *   ・同じ番号へすでに1回読み直した（読み直しても古いままのとき、繰り返さないため）
 */

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? ''
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const RELOADED_KEY = 'cidao_reloaded_for'

export function VersionRefresher() {
  useEffect(() => {
    if (!CURRENT) return
    let lastCheck = 0
    let dirtyPath: string | null = null
    let checking = false

    const onInput = () => {
      dirtyPath = window.location.pathname
    }

    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return
      const path = window.location.pathname
      if (dirtyPath === path) return
      if (path.includes('/reception')) return
      const now = Date.now()
      if (now - lastCheck < CHECK_INTERVAL_MS) return
      lastCheck = now
      checking = true
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const latest = String(((await res.json()) as { v?: unknown }).v ?? '')
        if (!latest || latest === CURRENT) return
        // 待っている間に入力が始まっていたら、やめる
        if (dirtyPath === window.location.pathname) return
        try {
          if (sessionStorage.getItem(RELOADED_KEY) === latest) return
          sessionStorage.setItem(RELOADED_KEY, latest)
        } catch {
          // 覚えられない端末では、繰り返しを防げないので読み直さない
          return
        }
        window.location.reload()
      } catch {
        // 通信できないときは何もしない（次に戻ってきたときにまた確かめる）
      } finally {
        checking = false
      }
    }

    const onVisible = () => {
      void check()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check()
    }

    document.addEventListener('input', onInput, true)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return null
}
