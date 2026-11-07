'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PushToggle } from '@/components/PushToggle'
import {
  PUSH_HOWTO_PATH,
  PUSH_INSTALL_PATH,
  PUSH_NUDGE_DISMISS_DAYS,
  decidePushNudge,
  type PushNudgeMode,
} from '@/lib/push-nudge'

const DISMISS_KEY = 'cidao_push_nudge_dismissed_at'

/**
 * ホーム（ログイン済み）に出すプッシュ通知の購読案内。
 * 表示条件: 「今は設定しない」から30日経過していること、かつ
 *   ・プッシュ対応ブラウザで未購読 → 「通知を受け取る」ボタン＋動画への入口
 *   ・iPhone の Safari（ホーム画面に追加する前） → 先に「ホーム画面に追加」の案内＋動画への入口
 * 購読済みの人と、それ以外の非対応ブラウザには何も表示しない。
 * （以前は iPhone の Safari が「非対応」と判定されて何も出ず、いちばん案内が要る人に届いていなかった）
 */
export function PushNudge() {
  const [mode, setMode] = useState<PushNudgeMode>('none')

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
        if (dismissedAt && Date.now() - dismissedAt < PUSH_NUDGE_DISMISS_DAYS * 86400_000) return

        const hasServiceWorker = 'serviceWorker' in navigator
        const hasPushManager = 'PushManager' in window
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
        const standalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)

        let subscribed = false
        if (hasServiceWorker && hasPushManager) {
          const reg = await navigator.serviceWorker.register('/sw.js')
          subscribed = !!(await reg.pushManager.getSubscription())
        }
        setMode(decidePushNudge({ hasServiceWorker, hasPushManager, isIos, standalone, subscribed }))
      } catch {
        // 権限エラー等は案内自体を出さない
      }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  if (mode === 'none') return null

  return (
    <section aria-label="プッシュ通知のご案内" className="space-y-1">
      {mode === 'toggle' ? (
        <PushToggle />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            📲 スマホにお知らせを届けるには、先に「ホーム画面に追加」します
          </p>
          <p className="text-[11px] text-slate-500">
            iPhoneでは、ホーム画面に追加したアイコンから開くと、アプリを閉じていても待機画面に通知が届くようになります（無料）。
          </p>
          <Link
            href={PUSH_INSTALL_PATH}
            className="inline-block text-xs font-semibold text-blue-600 hover:underline"
          >
            追加のしかたを見る
          </Link>
        </div>
      )}
      <Link
        href={PUSH_HOWTO_PATH}
        className="block text-[12px] font-semibold text-blue-600 hover:underline"
      >
        ▶ 約40秒の動画で、設定のしかたを見る
      </Link>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, String(Date.now()))
          setMode('none')
        }}
        className="text-[11px] text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
      >
        今は設定しない（{PUSH_NUDGE_DISMISS_DAYS}日間表示しません）
      </button>
    </section>
  )
}
