'use client'

// サイト全体のページ閲覧を記録する（PV / VV 集計用）。layout.tsx に1つだけ置く。
//
// - EventViewTracker と同じ方針: 匿名ID（localStorage）＋30分クールダウン＋失敗しても無音
// - App Router のクライアント遷移でも拾えるよう usePathname の変化で発火する
// - 管理画面・本人専用ページは記録しない（公開ページの実態が濁るため）
// - path はルートパターンに正規化して送る（/events/abc-123 → /events/[id]）。
//   個別イベントの内訳は EventViewTracker / event_views 側が担当

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { SIGNUP_SOURCE_COOKIE, SIGNUP_SOURCE_MAX_AGE, buildSignupSource } from '@/lib/signup-source'

const VISITOR_KEY = 'cidao_visitor_id'
const COOLDOWN_MS = 30 * 60 * 1000

// この接頭辞で始まるパスは記録しない
const EXCLUDED_PREFIXES = ['/admin', '/me', '/notifications', '/api', '/auth']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizePath(pathname: string): string {
  const segments = pathname.split('/').map((seg) => {
    if (UUID_RE.test(seg) || /^\d+$/.test(seg)) return '[id]'
    return seg
  })
  return segments.join('/').slice(0, 200) || '/'
}

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

export function PageViewTracker() {
  const pathname = usePathname()
  // React Strict Mode の二重実行で同じパスを2回送らないための直近記録
  const lastSent = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return

    const path = normalizePath(pathname)
    if (lastSent.current === path) return
    lastSent.current = path

    const visitorId = getVisitorId()
    if (!visitorId) return

    const stamp = `cidao_pv_${path}`
    try {
      const last = Number(sessionStorage.getItem(stamp) ?? '0')
      if (Date.now() - last < COOLDOWN_MS) return
      sessionStorage.setItem(stamp, String(Date.now()))
    } catch {
      // sessionStorage が使えなくても記録自体は進める
    }

    // SNS告知リンクの utm_source だけを拾って送る（値の検証はサーバ側で行う）。
    // usePathname にはクエリが含まれないため location.search から読む
    let source: string | null = null
    try {
      const q = new URLSearchParams(window.location.search)
      source = q.get('utm_source')
      // 登録経路も覚える（2026-11-07）：SNS の告知リンクはイベント・掲示板などのページに着くので、
      // /login だけで覚える仕組みでは数えられなかった。/login と同じ Cookie に入れ、初回ログインで auth/callback が members.signup_source に残す
      const src = buildSignupSource(source, q.get('utm_medium'), q.get('utm_campaign'))
      if (src) {
        const secure = window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `${SIGNUP_SOURCE_COOKIE}=${encodeURIComponent(src)}; Max-Age=${SIGNUP_SOURCE_MAX_AGE}; Path=/; SameSite=Lax${secure}`
      }
    } catch { /* 読めなければ流入元なし扱い */ }

    void fetch('/api/track/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, visitorId, source }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])

  return null
}
