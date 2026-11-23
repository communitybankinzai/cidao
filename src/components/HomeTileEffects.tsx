'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * ホームのボタンの動き（2026-11-23 事業主決定）。
 *
 *   ・押すと弾む／アイコンが揺れる：押したボタン（.cidao-tile）に is-popped を付ける。動きそのものは globals.css
 *   ・新着の印：タイルを押したら「見た」時刻をこの端末に覚える（NewDot が読む）
 *
 * ButtonFeedback（波紋・処理中の表示）とは別に、ホームだけで動かす。
 * 「動きを減らす」設定の端末では、globals.css 側で動きを止めている
 */

const SEEN_PREFIX = 'cidao:seen:'
const SEEN_EVENT = 'cidao:seen'

function readSeen(key: string): string {
  try {
    return window.localStorage.getItem(SEEN_PREFIX + key) ?? ''
  } catch {
    // プライベートブラウズなどで読めないときは「見ていない」扱い
    return ''
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(SEEN_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(SEEN_EVENT, onChange)
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(SEEN_PREFIX + key, String(Date.now()))
    window.dispatchEvent(new Event(SEEN_EVENT))
  } catch {
    // 覚えられなくても、ページの移動は止めない
  }
}

/**
 * 下段（「あったらいいな」の実例）が押された回数を数える（2026-11-23 事業主決定）。
 * 閲覧数と同じ仕組み（/api/track/view → page_views）に、/go/<名前> という仮のパスで1件入れる。
 * 管理画面の「アクセス分析」のページ別に /go/3dmap などとして出る。
 * 端末の匿名IDは PageViewTracker が作ったもの（cidao_visitor_id）を使う。無ければ数えない
 */
function trackGo(name: string): void {
  try {
    const visitorId = window.localStorage.getItem('cidao_visitor_id')
    if (!visitorId) return
    void fetch('/api/track/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `/go/${name}`, visitorId }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 数えられなくても、ページの移動は止めない
  }
}

/**
 * 一覧ページ（掲示板・イベント）を開いたら「見た」と覚える。
 * 下のメニューなど、ホームのタイル以外から開いたときも新着の印が消えるようにする
 */
export function MarkSeen({ seenKey }: { seenKey: string }) {
  useEffect(() => {
    markSeen(seenKey)
  }, [seenKey])
  return null
}

export function HomeTileEffects() {
  useEffect(() => {
    const tileOf = (e: Event): HTMLElement | null => {
      const el = e.target as HTMLElement | null
      return el?.closest ? el.closest<HTMLElement>('.cidao-tile') : null
    }

    const onPointerDown = (e: PointerEvent) => {
      const tile = tileOf(e)
      if (!tile) return
      // 続けて押しても毎回動くよう、いったん外して付け直す
      tile.classList.remove('is-popped')
      void tile.offsetWidth
      tile.classList.add('is-popped')
      // 動きが終わったら外す（付けたままだと、PC でカーソルを乗せたときの揺れが出なくなる）
      window.setTimeout(() => tile.classList.remove('is-popped'), 600)
    }

    const onClick = (e: MouseEvent) => {
      const tile = tileOf(e)
      if (!tile) return
      if (tile.dataset.seenKey) markSeen(tile.dataset.seenKey)
      if (tile.dataset.track) trackGo(tile.dataset.track)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  return null
}

/**
 * 新着の印（タイルの右上で脈打つ赤い点）。
 *
 *   ・この端末でそのタイルを押したことがある → それより後に新しい投稿があれば出す
 *   ・押したことがない → 直近（サーバーが決めた日数）に新しい投稿があれば出す
 *
 * サーバーで描くときは出さない（端末の記録を読めないため）。読めた後に出るので、表示のずれは起きない
 */
export function NewDot({
  seenKey,
  latestAt,
  recent,
}: {
  seenKey: string
  /** いちばん新しい投稿の時刻（ミリ秒）。無ければ null */
  latestAt: number | null
  /** 初めての端末で印を出すか（直近に新しい投稿があるか）。サーバーが判定して渡す */
  recent: boolean
}) {
  const seen = useSyncExternalStore(
    subscribe,
    () => readSeen(seenKey),
    () => null,
  )
  if (seen === null || latestAt === null) return null
  const seenAt = Number(seen)
  const show = seen !== '' && Number.isFinite(seenAt) ? latestAt > seenAt : recent
  if (!show) return null
  return (
    <span className="cidao-new-dot absolute right-2.5 top-2.5 size-2.5 rounded-full bg-rose-600 dark:bg-rose-500">
      <span className="sr-only">新着あり</span>
    </span>
  )
}
