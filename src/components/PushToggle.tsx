'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { savePushSubscription, deletePushSubscription } from '@/app/notifications/actions'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/**
 * マイページの「スマホ・PCへのプッシュ通知」設定カード。
 * 有効化するとアプリを閉じていても待機画面に通知が届く。
 */
export function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isIosBrowser, setIsIosBrowser] = useState(false)

  useEffect(() => {
    const init = setTimeout(() => {
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
      setIsIosBrowser(iOS && !standalone)

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setSupported(false)
        return
      }
      setSupported(true)
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setSubscribed(!!sub))
        .catch(() => setSupported(false))
    }, 0)
    return () => clearTimeout(init)
  }, [])

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('ブラウザの通知が許可されませんでした（端末の設定から許可できます）')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
      const json = sub.toJSON()
      await savePushSubscription({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      })
      setSubscribed(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await deletePushSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            📲 スマホ・PCへのプッシュ通知
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            有効にすると、アプリを閉じていても待機画面に通知が届きます（コメント・いいね・声がけなど）
          </p>
        </div>
        {supported && (
          <Button
            size="sm"
            variant={subscribed ? 'outline' : 'default'}
            disabled={busy}
            onClick={subscribed ? disable : enable}
            className="shrink-0"
          >
            {busy ? '処理中…' : subscribed ? '通知を止める' : '通知を受け取る'}
          </Button>
        )}
      </div>
      {supported === false && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          このブラウザはプッシュ通知に対応していません。
          {isIosBrowser && 'iPhoneでは、共有メニューから「ホーム画面に追加」して、そのアイコンから開くと有効化できます。'}
        </p>
      )}
      {supported && isIosBrowser && !subscribed && (
        <p className="text-[11px] text-slate-500">
          ※ iPhoneの場合は、共有メニュー →「ホーム画面に追加」→ 追加したアイコンから開いてボタンを押してください
        </p>
      )}
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </section>
  )
}
