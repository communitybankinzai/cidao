'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  getMyNotifications,
  markAllNotificationsRead,
  type NotificationRow,
} from '@/app/notifications/actions'
import { createClient } from '@/lib/supabase/client'
import { KIND_ICON } from '@/lib/notification-kinds'

/**
 * Realtime を購読できなかったときだけ使う保険の再取得間隔。
 * 通常は WebSocket で届くのでこのタイマーは動かない。
 */
const FALLBACK_POLL_INTERVAL_MS = 5 * 60_000

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

  /** 取得して、ログイン状態と自分の member id を返す（失敗時は状態を変えない） */
  const reload = useCallback(async (): Promise<{
    loggedIn: boolean
    userId: string | null
  }> => {
    try {
      const r = await getMyNotifications()
      setLoggedIn(r.loggedIn)
      setRows(r.rows)
      setUnread(r.unread)
      return { loggedIn: r.loggedIn, userId: r.userId }
    } catch {
      // 取得失敗は表示だけ諦める。購読も張らず、保険のポーリングに任せる
      return { loggedIn: true, userId: null }
    }
  }, [])

  // getMyNotifications は Server Action のため、呼ぶたびに Vercel Function が起動する。
  // 旧実装は全ページで60秒ごとに呼んでおり、未ログインでもタブ非表示でも止まらず、
  // Fluid Active CPU の無料枠（4時間/月）の大半を消費していた（2026-08-26）。
  //
  // そこでポーリングをやめ、Supabase Realtime の購読に切り替えた。
  //   - Server Action を呼ぶのはマウント時の1回だけ（初期表示と userId の取得）
  //   - 以降の新着は WebSocket で届く。Vercel を経由しないので無料枠を消費しない
  //   - 未ログインなら購読も張らない（訪問者の大半は未ログイン）
  //   - 購読に失敗したときだけ 5分間隔のポーリングへ退避する
  // notifications テーブルが supabase_realtime publication に入っていないと
  // 購読は失敗するが、その場合も上の退避が効くので通知は届く。
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null
    let channel: RealtimeChannel | null = null
    const supabase = createClient()

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    /** 購読が張れなかったときの保険。タブが非表示の間は呼ばない */
    const startPollingFallback = () => {
      if (timer || disposed) return
      timer = setInterval(() => {
        if (document.visibilityState === 'hidden') return
        void reload()
      }, FALLBACK_POLL_INTERVAL_MS)
    }

    const subscribe = (uid: string) => {
      channel = supabase
        .channel(`notifications-${uid}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            // RLS でも本人以外は届かないが、無駄な受信を避けるため絞る
            filter: `recipient_id=eq.${uid}`,
          },
          (payload) => {
            const row = payload.new as NotificationRow
            setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)].slice(0, 30))
            setUnread((prev) => prev + 1)
          },
        )
        .subscribe((status) => {
          if (disposed) return
          if (status === 'SUBSCRIBED') stopPolling()
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startPollingFallback()
        })
    }

    const init = async () => {
      const r = await reload()
      if (disposed || !r.loggedIn) return
      if (!r.userId) {
        startPollingFallback()
        return
      }
      // RLS 付きテーブルの購読にはアクセストークンが要る。
      // セッション復元を待ってから購読する（Cookie を読むだけで Vercel は経由しない）
      await supabase.auth.getSession()
      if (disposed) return
      subscribe(r.userId)
    }

    void init()

    return () => {
      disposed = true
      stopPolling()
      if (channel) void supabase.removeChannel(channel)
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
