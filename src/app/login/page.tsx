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

  // 認証プロバイダから戻された際のエラー（クエリ・ハッシュ両方）を画面に表示する
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
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
            <p className="text-sm text-red-600 dark:text-red-400">
              ログインに失敗しました：{error}
            </p>
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
