'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getMyNotifications,
  markAllNotificationsRead,
  type NotificationRow,
} from '@/app/notifications/actions'

const KIND_ICON: Record<string, string> = {
  comment: '💬',
  vote: '🗳️',
  proposal: '📋',
  system: '🔧',
}

/**
 * 全ページ右上に固定表示するアプリ内通知ベル。
 * 未ログイン時・通知0件時はベルのみ（バッジなし）。ドロップダウンを開くと既読化する。
 */
export function NotificationBell() {
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(async () => {
    try {
      const r = await getMyNotifications()
      setLoggedIn(r.loggedIn)
      setRows(r.rows)
      setUnread(r.unread)
    } catch {
      // 取得失敗は表示だけ諦める
    }
  }, [])

  useEffect(() => {
    const initial = setTimeout(reload, 0)
    const timer = setInterval(reload, 60_000)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [reload])

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      await markAllNotificationsRead()
      setUnread(0)
      setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })))
    }
  }

  if (!loggedIn) return null

  return (
    <div ref={wrapRef} className="fixed top-3 right-3 z-50">
      <button
        type="button"
        onClick={toggle}
        aria-label={`通知 ${unread > 0 ? `（未読${unread}件）` : ''}`}
        className="relative flex items-center justify-center w-10 h-10 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 shadow hover:bg-slate-50 dark:hover:bg-slate-800 transition"
      >
        <span aria-hidden className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-100 dark:border-slate-800">
            通知
          </div>
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-400 text-center">通知はまだありません</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <li key={r.id}>
                  <a
                    href={r.link_url ?? '#'}
                    className={
                      'block px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition ' +
                      (!r.read_at ? 'bg-sky-50/60 dark:bg-sky-950/40' : '')
                    }
                  >
                    <div className="flex gap-2">
                      <span aria-hidden className="shrink-0">{KIND_ICON[r.kind] ?? '🔔'}</span>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-900 dark:text-slate-100 leading-snug">{r.title}</p>
                        {r.body && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">{r.body}</p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(r.created_at).toLocaleString('ja-JP')}
                        </p>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
