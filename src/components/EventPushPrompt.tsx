'use client'

import { useEffect, useState } from 'react'
import { PushToggle } from '@/components/PushToggle'

const DISMISS_KEY = 'cidao_event_push_prompt_dismissed_at'
const REMIND_AFTER_DAYS = 7

/**
 * 参加登録したイベントの詳細ページに出す、プッシュ通知の許可依頼。
 * 「前日の朝にお知らせします」という用途が分かる場面で頼むための部品。
 * 表示条件: プッシュ対応ブラウザ・この端末が未購読・通知が拒否されていない・
 * 「今は設定しない」から7日経過。それ以外（購読済み・非対応・拒否済み）には何も出さない。
 */
export function EventPushPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return
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
    <div className="space-y-1">
      <PushToggle
        heading="📲 前日の朝に、このイベントをお知らせします"
        description="参加登録したイベントは、前日の朝にベル🔔でお知らせします。通知をオンにすると、アプリを閉じていてもスマホに届くので、うっかり忘れを防げます"
      />
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, String(Date.now()))
          } catch {
            // 保存できなくても、この画面では閉じる
          }
          setShow(false)
        }}
        className="text-[11px] text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
      >
        今は設定しない（7日間表示しません）
      </button>
    </div>
  )
}
