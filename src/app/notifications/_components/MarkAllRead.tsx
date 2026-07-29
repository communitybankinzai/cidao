'use client'

import { useEffect } from 'react'
import { markAllNotificationsRead } from '../actions'

/**
 * 一覧ページを開いたときに未読をまとめて既読化する（描画なし）。
 * ベル🔔を開いたときの既読化と同じ関数を使う。
 * 未読の背景色はこのページを再読み込みするまで残る（どれが新しかったか分かるように）。
 */
export function MarkAllRead({ hasUnread }: { hasUnread: boolean }) {
  useEffect(() => {
    if (hasUnread) void markAllNotificationsRead()
  }, [hasUnread])
  return null
}
