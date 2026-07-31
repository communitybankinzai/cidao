'use client'

// イベント詳細ページを開いたことを1回だけ記録する。
//
// - 端末ごとの匿名ID（localStorage）を作り、サーバでハッシュ化して VV の判定に使う
// - 同じイベントは30分に1回までしか送らない（リロード連打で PV が跳ねるのを防ぐ）
// - 開発時の二重実行（React Strict Mode）も ref で抑止する
// - 失敗しても画面には何も出さない。閲覧体験を邪魔しない

import { useEffect, useRef } from 'react'

const VISITOR_KEY = 'cidao_visitor_id'
const COOLDOWN_MS = 30 * 60 * 1000

function getVisitorId(): string | null {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    // プライベートモード等で localStorage が使えない場合は記録しない
    return null
  }
}

export function EventViewTracker({ eventId }: { eventId: string }) {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true

    const visitorId = getVisitorId()
    if (!visitorId) return

    const stamp = `cidao_view_${eventId}`
    try {
      const last = Number(sessionStorage.getItem(stamp) ?? '0')
      if (Date.now() - last < COOLDOWN_MS) return
      sessionStorage.setItem(stamp, String(Date.now()))
    } catch {
      // sessionStorage が使えなくても記録自体は進める
    }

    void fetch(`/api/events/${eventId}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId }),
      keepalive: true,
    }).catch(() => {})
  }, [eventId])

  return null
}
