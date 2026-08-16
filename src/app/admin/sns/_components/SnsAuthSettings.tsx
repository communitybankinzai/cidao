'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { saveThreadsAuth, saveThreadsAppCredentials, saveFacebookAuth, saveInstagramAuth, saveInstagramDiscoveryAuth } from '../actions'

// SNS接続設定：運営が取得したトークンを貼り付けて保存する。
// 保存時にサーバー側で実際に API を叩いて検証するため、貼り間違いはここで弾かれる。
// トークンの現在値は画面に表示しない（設定済みかどうかと接続先の名前だけ見せる）。

export type SnsAuthStatus = {
  threads: { username: string; savedAt: string; expiresAt: string | null; keywordSearchReady?: boolean } | null
  threadsApp: { savedAt: string } | null
  facebook: { pageName: string; savedAt: string } | null
  instagram: { username: string; savedAt: string; expiresAt: string | null } | null
  instagramDiscovery: { username: string; savedAt: string } | null
}

export default function SnsAuthSettings({ status }: { status: SnsAuthStatus }) {
  // 接続状態のサマリー（折りたたんだままでも状態が分かるように見出し横へ出す）
  const summary = [
    status.threads ? '🧵✓' : '🧵—',
    status.instagram ? '📷✓' : '📷—',
    status.instagramDiscovery ? 'IG検索✓' : 'IG検索—',
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
        <ThreadsForm current={status.threads} app={status.threadsApp} />
        <InstagramForm current={status.instagram} />
        <InstagramDiscoveryForm current={status.instagramDiscovery} />
        <FacebookForm current={status.facebook} />
      </div>
    </details>
  )
}

function InstagramDiscoveryForm({ current }: { current: SnsAuthStatus['instagramDiscovery'] }) {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit() {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await saveInstagramDiscoveryAuth(userId, token)
        setMessage(`保存しました（検索対象: @${result.username || result.userId}）`)
        setToken('')
        setUserId('')
      } catch (error) {
        setMessage(`エラー: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-sm">Instagram 公開ハッシュタグ検索</h3>
        {current ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            設定済み（@{current.username} / {new Date(current.savedAt).toLocaleDateString('ja-JP')} 保存）
          </span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">未設定</span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        災害投稿の巡回専用です。Facebook Login方式で取得した、InstagramプロアカウントIDと
        ハッシュタグ検索権限を含むユーザーアクセストークンを登録します。上の投稿用トークンとは別です。
      </p>
      <input
        type="text"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
        placeholder="InstagramプロアカウントID"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <input
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="Facebook Login ユーザーアクセストークン"
        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <div className="flex items-center gap-3">
        <Button onClick={submit} size="sm" disabled={pending || !token.trim() || !userId.trim()}>
          {pending ? '検索権限を検証中…' : current ? '検証して上書き保存' : '検証して保存'}
        </Button>
        {message && <span className="text-xs">{message}</span>}
      </div>
    </div>
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

// 検索権限つき再認証の案内ブロック。
// トークン生成ツールは threads_keyword_search を要求できないため、
// アプリID・app secret を登録したうえで自前のOAuth認可URLへ誘導する。
function ThreadsSearchReauth({ current, app }: { current: SnsAuthStatus['threads']; app: SnsAuthStatus['threadsApp'] }) {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submitCredentials() {
    setMessage(null)
    startTransition(async () => {
      try {
        await saveThreadsAppCredentials(appId, appSecret)
        setMessage('✓ 保存しました。下の「検索権限つきで再認証」へ進んでください')
        setAppId('')
        setAppSecret('')
      } catch (e) {
        setMessage(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  if (current?.keywordSearchReady) {
    return <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 公開投稿検索（keyword_search）利用可</p>
  }
  return (
    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
      <p className="text-xs text-amber-800 dark:text-amber-300">
        公開投稿検索（災害SNS巡回のThreads枠）には <code>threads_keyword_search</code> 権限つきの再認証が必要です。
        Meta開発者コンソールのトークン生成ツールではこの権限を付けられないため、ここから再認証します。
      </p>
      {!app && (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            ① Meta開発者コンソール「Threads APIにアクセス」→「設定」の <b>ThreadsアプリID</b> と <b>Threadsのapp secret</b>（表示ボタンで確認）を登録:
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="ThreadsアプリID（数字）"
              className="flex-1 min-w-40 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              autoComplete="off"
            />
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="Threadsのapp secret"
              className="flex-1 min-w-40 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              autoComplete="off"
            />
            <Button onClick={submitCredentials} size="sm" disabled={pending || !appId.trim() || !appSecret.trim()}>
              {pending ? '保存中…' : '保存'}
            </Button>
          </div>
        </>
      )}
      {app && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          ② 事前にMeta開発者コンソールの「コールバックURLをリダイレクト」へ
          <code className="mx-1 break-all">https://cidao.vercel.app/api/admin/sns/threads-oauth/callback</code>
          を登録・保存してから:
        </p>
      )}
      <div className="flex items-center gap-3">
        {app ? (
          <a
            href="/api/admin/sns/threads-oauth/start"
            className="inline-flex items-center rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-1.5 text-xs font-medium hover:opacity-85"
          >
            🔁 検索権限つきで再認証
          </a>
        ) : (
          <span className="inline-flex items-center rounded bg-slate-200 dark:bg-slate-800 text-slate-400 px-3 py-1.5 text-xs font-medium cursor-not-allowed">
            🔁 検索権限つきで再認証（先に①を保存）
          </span>
        )}
        {app && <span className="text-xs text-slate-500">アプリ認証情報 設定済み（{app.savedAt ? new Date(app.savedAt).toLocaleDateString('ja-JP') : ''}）</span>}
      </div>
      {message && <p className="text-xs">{message}</p>}
    </div>
  )
}

function ThreadsForm({ current, app }: { current: SnsAuthStatus['threads']; app: SnsAuthStatus['threadsApp'] }) {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit() {
    setMessage(null)
    startTransition(async () => {
      try {
        const r = await saveThreadsAuth(userId, token)
        setMessage(r.keywordSearchReady
          ? `✓ 保存しました（@${r.username} / 公開投稿検索も利用可）`
          : `保存しました（@${r.username}）。投稿は可能ですが、公開投稿検索には threads_keyword_search 権限を含む再認証が必要です。`)
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
      <ThreadsSearchReauth current={current} app={app} />
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
