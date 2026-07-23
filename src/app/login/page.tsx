'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

// LINEログイン一本化（仕様書 v2.1、2026-07-20）
// Supabase Custom OIDC Provider として登録した LINE Login を使用。
// プロバイダIDはSupabaseダッシュボードの Custom Providers に登録した値と一致させること。
const LINE_PROVIDER = 'custom:line'

export default function LoginPage() {
  const [status, setStatus] = useState<'idle' | 'redirecting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const [notice, setNotice] = useState<string | null>(null)
  const [inAppBrowser, setInAppBrowser] = useState(false)

  // LINEアプリ内蔵ブラウザ（WebView）は、OAuth往復でストレージが分離されることがあり
  // 「PKCE code verifier not found」エラーの主な原因になる。事前に検出して案内する。
  useEffect(() => {
    const ua = navigator.userAgent || ''
    if (/\bLine\//i.test(ua)) {
      setInAppBrowser(true)
    }
  }, [])

  function openInExternalBrowser() {
    const url = window.location.href
    const ua = navigator.userAgent || ''
    if (/iphone|ipad|ipod/i.test(ua)) {
      // iOS: Safari を強制起動するスキーム
      window.location.href = url.replace(/^https?:\/\//i, 'x-safari-https://')
    } else if (/android/i.test(ua)) {
      // Android: Chrome を強制起動する intent スキーム
      const stripped = url.replace(/^https?:\/\//i, '')
      window.location.href = `intent://${stripped}#Intent;scheme=https;package=com.android.chrome;end`
    } else {
      window.open(url, '_blank')
    }
  }

  // 認証プロバイダから戻された際のエラー（クエリ・ハッシュ両方）を画面に表示する
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (search.get('deleted') === '1') {
      setNotice('退会手続きが完了しました。30日以内にLINEで再ログインすればアカウントを復元できます。')
      return
    }
    const desc =
      hash.get('error_description') ??
      search.get('error_description') ??
      hash.get('error_code') ??
      hash.get('error') ??
      search.get('error')
    if (desc) {
      setStatus('error')
      setError(decodeURIComponent(desc.replace(/\+/g, ' ')))
    }
  }, [])

  async function handleLineLogin() {
    setStatus('redirecting')
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      // Custom Provider は組み込み Provider 型に含まれないためキャストが必要
      provider: LINE_PROVIDER as 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setError(error.message)
    }
    // 成功時は LINE の認可画面へリダイレクトされるため後続処理は不要
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-8">
      <main className="max-w-md w-full space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">
            CiDAO · Citizen DAO
          </p>
          <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">
            ログイン
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            LINEアカウントでログイン・新規登録ができます
          </p>
        </header>

        <div className="space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          {inAppBrowser && (
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                ⚠️ LINEのアプリ内で開いています
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                この状態のままだとログインに失敗することがあります。お手数ですが、下のボタンからSafari（またはChrome）で開き直してください。
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={openInExternalBrowser}
                className="w-full border-amber-400 text-amber-900 dark:text-amber-100"
              >
                外部ブラウザで開く
              </Button>
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                うまく開かない場合は、右下または右上の「…」メニューから「他のアプリで開く」を選んでください。
              </p>
            </div>
          )}
          {notice && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-3">
              <p className="text-xs text-emerald-900 dark:text-emerald-100">{notice}</p>
            </div>
          )}
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              なぜLINEログインなの？
            </p>
            <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1 list-disc list-inside leading-relaxed">
              <li><strong>投票の公正性のため</strong>：LINEアカウントは電話番号で本人確認されているため、1人が複数アカウントで投票する不正を防げます。みなさんの1票の重みを守る仕組みです</li>
              <li><strong>かんたん・安全</strong>：パスワードを新しく作る必要がなく、使い慣れたLINEでそのままログインできます</li>
              <li><strong>無料で運営できる</strong>：SMS認証などの有料サービスを使わず、市民活動の限られた予算で本人確認を実現しています</li>
            </ul>
          </div>

          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              安心してご利用ください
            </p>
            <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1 list-disc list-inside leading-relaxed">
              <li>CiDAOがLINEのトーク内容や友だち情報にアクセスすることはありません</li>
              <li>電話番号がCiDAOに送られることもありません（LINE内での確認に使われるだけです）</li>
              <li>初めての方はログイン後にプロフィール登録へ進みます</li>
            </ul>
          </div>

          <Button
            type="button"
            onClick={handleLineLogin}
            disabled={status === 'redirecting'}
            className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white"
          >
            {status === 'redirecting' ? 'LINEへ移動中…' : 'LINEでログイン'}
          </Button>

          {error && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-3 space-y-2">
              {/PKCE|code verifier/i.test(error) ? (
                <>
                  <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                    ログインに失敗しました
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                    アプリ内ブラウザ（LINE等）で開いている場合や、しばらく時間が経ってから戻ってきた場合に起きることがあります。
                    お手数ですが、Safari（またはChrome）で開き直して、もう一度お試しください。
                  </p>
                </>
              ) : (
                <p className="text-sm text-red-600 dark:text-red-400">
                  ログインに失敗しました：{error}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-slate-500 text-center pt-2">
            初めての方は自動でアカウント作成されます
          </p>
        </div>

        <p className="text-xs text-slate-400 text-center leading-relaxed">
          以前メールアドレスでご登録いただいた方は、お手数ですが
          LINEログイン後に改めてプロフィール登録をお願いします
          （順次、運営から個別にご案内します）
        </p>
      </main>
    </div>
  )
}
