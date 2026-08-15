'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { saveThreadsAuth, saveFacebookAuth, saveInstagramAuth } from '../actions'

// SNS接続設定：運営が取得したトークンを貼り付けて保存する。
// 保存時にサーバー側で実際に API を叩いて検証するため、貼り間違いはここで弾かれる。
// トークンの現在値は画面に表示しない（設定済みかどうかと接続先の名前だけ見せる）。

export type SnsAuthStatus = {
  threads: { username: string; savedAt: string; expiresAt: string | null } | null
  facebook: { pageName: string; savedAt: string } | null
  instagram: { username: string; savedAt: string; expiresAt: string | null } | null
}

export default function SnsAuthSettings({ status }: { status: SnsAuthStatus }) {
  // 接続状態のサマリー（折りたたんだままでも状態が分かるように見出し横へ出す）
  const summary = [
    status.threads ? '🧵✓' : '🧵—',
    status.instagram ? '📷✓' : '📷—',
    status.facebook ? '📘✓' : '📘—',
  ].join(' ')

  return (
    <details className="bg-white dark:bg-slate-900 border rounded-lg p-5 group">
      <summary className="cursor-pointer flex items-center gap-3 list-none">
        <h2 className="text-lg font-semibold">🔑 SNS接続設定</h2>
        <span className="text-xs text-slate-500">{summary}</span>
        <span className="ml-auto text-xs text-slate-400 group-open:hidden">クリックで開く（トークンの登録・更新時のみ）</span>
      </summary>
      <div className="mt-4 space-y-5">
        <p className="text-xs text-slate-500">
          Meta for Developers で取得したトークンをここに貼り付けて保存します。保存時に実際にAPIへ接続して検証します。
          Threads / Instagram のトークンは60日で失効しますが、保存後は毎週自動で更新（リフレッシュ）されるため、日常の操作は不要です。
        </p>
        <ThreadsForm current={status.threads} />
        <InstagramForm current={status.instagram} />
        <FacebookForm current={status.facebook} />
      </div>
    </details>
  )
}

function InstagramForm({ current }: { current: SnsAuthStatus['instagram'] }) {
  const [token, setToken] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit() {
    setMessage(null)
    startTransition(async () => {
      try {
        const r = await saveInstagramAuth(token)
        setMessage(`✓ 保存しました（接続先: @${r.username}）`)
        setToken('')
      } catch (e) {
        setMessage(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">📷 Instagram</h3>
        {current ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ 設定済み（@{current.username} / {new Date(current.savedAt).toLocaleDateString('ja-JP')} 保存
            {current.expiresAt ? ` / ${new Date(current.expiresAt).toLocaleDateString('ja-JP')} 失効予定` : ''}）
          </span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">未設定</span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        投稿には告知カード画像（提案タイトル入り・自動生成）が使われます。トークンは Threads と同じアプリの
        「Instagramでメッセージとコンテンツを管理」ユースケースから生成します。
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="長期アクセストークン"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <div className="flex items-center gap-3">
        <Button onClick={submit} size="sm" disabled={pending || !token.trim()}>
          {pending ? '検証中…' : current ? '検証して上書き保存' : '検証して保存'}
        </Button>
        {message && <span className="text-xs">{message}</span>}
      </div>
    </div>
  )
}

function ThreadsForm({ current }: { current: SnsAuthStatus['threads'] }) {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit() {
    setMessage(null)
    startTransition(async () => {
      try {
        const r = await saveThreadsAuth(userId, token)
        setMessage(`✓ 保存しました（接続先: @${r.username}）`)
        setToken('')
        setUserId('')
      } catch (e) {
        setMessage(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">🧵 Threads</h3>
        {current ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ 設定済み（@{current.username} / {new Date(current.savedAt).toLocaleDateString('ja-JP')} 保存
            {current.expiresAt ? ` / ${new Date(current.expiresAt).toLocaleDateString('ja-JP')} 失効予定` : ''}）
          </span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">未設定</span>
        )}
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="長期アクセストークン（THAA… で始まる文字列）"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <input
        type="text"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="ThreadsユーザーID（空欄なら自動取得）"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <div className="flex items-center gap-3">
        <Button onClick={submit} size="sm" disabled={pending || !token.trim()}>
          {pending ? '検証中…' : current ? '検証して上書き保存' : '検証して保存'}
        </Button>
        {message && <span className="text-xs">{message}</span>}
      </div>
    </div>
  )
}

function FacebookForm({ current }: { current: SnsAuthStatus['facebook'] }) {
  const [token, setToken] = useState('')
  const [pageId, setPageId] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit() {
    setMessage(null)
    startTransition(async () => {
      try {
        const r = await saveFacebookAuth(pageId, token)
        setMessage(`✓ 保存しました（接続先: ${r.pageName}）`)
        setToken('')
        setPageId('')
      } catch (e) {
        setMessage(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">📘 Facebookページ</h3>
        {current ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ 設定済み（{current.pageName} / {new Date(current.savedAt).toLocaleDateString('ja-JP')} 保存）
          </span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">未設定</span>
        )}
      </div>
      <input
        type="text"
        value={pageId}
        onChange={(e) => setPageId(e.target.value)}
        placeholder="ページID（数字）"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ページアクセストークン"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <div className="flex items-center gap-3">
        <Button onClick={submit} size="sm" disabled={pending || !token.trim() || !pageId.trim()}>
          {pending ? '検証中…' : current ? '検証して上書き保存' : '検証して保存'}
        </Button>
        {message && <span className="text-xs">{message}</span>}
      </div>
    </div>
  )
}
