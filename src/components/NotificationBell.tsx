'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getMyNotifications,
  markAllNotificationsRead,
  type NotificationRow,
} from '@/app/notifications/actions'
import { KIND_ICON } from '@/lib/notification-kinds'

/** 通知の再取得間隔。Vercel の無料枠を守るため長めに取る（下の useEffect のコメント参照） */
const POLL_INTERVAL_MS = 5 * 60_000

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

  /** 取得してログイン中かどうかを返す（失敗時は状態を変えず true 扱いで継続） */
  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const r = await getMyNotifications()
      setLoggedIn(r.loggedIn)
      setRows(r.rows)
      setUnread(r.unread)
      return r.loggedIn
    } catch {
      // 取得失敗は表示だけ諦める
      return true
    }
  }, [])

  // getMyNotifications は Server Action のため、呼ぶたびに Vercel Function が起動する。
  // 旧実装（全ページで60秒ごと・未ログインでも継続・タブ非表示でも継続）が
  // Fluid Active CPU の無料枠（4時間/月）の大半を消費していたため、
  // 次の3点で呼び出しを絞る（2026-08-26）。
  //   1. 未ログインと判明した時点でポーリングを止める（訪問者の大半は未ログイン）
  //   2. 間隔は5分（通知ベルに即時性は要らない）
  //   3. タブが非表示の間は呼ばない（開きっぱなしのタブが枠を食っていた）
  // ログイン直後は /auth/callback からの遷移で再マウントされるため、
  // 停止したポーリングはそこで張り直される。
  useEffect(() => {
    let polling = true
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      polling = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const tick = async () => {
      if (!polling) return
      if (document.visibilityState === 'hidden') return
      if (!(await reload())) stop()
    }

    // タブが前面に戻ったときだけ、非表示中の取りこぼしを1回補う
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void tick()
    }

    timer = setInterval(tick, POLL_INTERVAL_MS)
    void tick()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
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
              {rows.map((r) => {
                const cls =
                  'block px-3 py-2.5 ' +
                  (r.link_url ? 'hover:bg-slate-50 dark:hover:bg-slate-800 transition ' : '') +
                  (!r.read_at ? 'bg-sky-50/60 dark:bg-sky-950/40' : '')
                const inner = (
                  <div className="flex gap-2">
                    <span aria-hidden className="shrink-0">{KIND_ICON[r.kind] ?? '🔔'}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-900 dark:text-slate-100 leading-snug">{r.title}</p>
                      {/* 本文は3行まで。続きは一覧ページで全文を読む */}
                      {r.body && (
                        <p className="text-[11px] text-slate-500 line-clamp-3 whitespace-pre-wrap mt-0.5">
                          {r.body}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(r.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                  </div>
                )
                return (
                  <li key={r.id}>
                    {/* リンク先の無い通知（一斉お知らせ等）は a にしない。'#' へ飛ばさないため */}
                    {r.link_url ? (
                      <a href={r.link_url} className={cls}>{inner}</a>
                    ) : (
                      <div className={cls}>{inner}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <a
            href="/notifications"
            className="block px-3 py-2 text-center text-xs text-blue-600 dark:text-blue-400 border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            すべての通知を見る →
          </a>
        </div>
      )}
    </div>
  )
}
