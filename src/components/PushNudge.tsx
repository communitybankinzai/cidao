'use client'

import { useEffect, useState } from 'react'
import { PushToggle } from '@/components/PushToggle'

const DISMISS_KEY = 'cidao_push_nudge_dismissed_at'
const REMIND_AFTER_DAYS = 30

/**
 * ホーム（ログイン済み）に出すプッシュ通知の購読案内。
 * 表示条件: プッシュ対応ブラウザ・未購読・「今は設定しない」から30日経過。
 * 購読済みの人と非対応ブラウザには何も表示しない。
 */
export function PushNudge() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
        if (dismissedAt && Date.now() - dismissedAt < REMIND_AFTER_DAYS * 86400_000) return
        const reg = await navigator.serviceWorker.register('/sw.js')
        const sub = await reg.pushManager.getSubscription()
        if (!sub) setShow(true)
      } catch {
        // 非対応・権限エラー等は案内自体を出さない
      }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  if (!show) return null

  return (
    <section aria-label="プッシュ通知のご案内" className="space-y-1">
      <PushToggle />
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, String(Date.now()))
          setShow(false)
        }}
        className="text-[11px] text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
      >
        今は設定しない（30日間表示しません）
      </button>
    </section>
  )
}
