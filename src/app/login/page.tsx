'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setError(translateAuthError(error.message))
    } else {
      setStatus('sent')
    }
  }

  function translateAuthError(message: string): string {
    const lower = message.toLowerCase()
    if (lower.includes('rate limit')) {
      return 'メール送信が一時的に制限されています。直近で届いたログインリンクが残っていればそれをご利用ください。新しいリンクが必要な場合は1時間ほどおいてから再度お試しください。'
    }
    if (lower.includes('invalid') && lower.includes('email')) {
      return 'メールアドレスの形式が正しくありません。'
    }
    return message
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
            メールアドレスを入力するとログインリンクが届きます
          </p>
        </header>

        {status === 'sent' ? (
          <div className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 rounded-lg p-6 text-center space-y-2">
            <p className="text-emerald-900 dark:text-emerald-100 font-semibold">
              メールを送信しました
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              <span className="font-mono">{email}</span> に届いたリンクをクリックしてください。
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              数分以内に届かない場合は迷惑メールフォルダもご確認ください。
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                送信前にご確認ください
              </p>
              <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside leading-relaxed">
                <li><strong>ログインメアドは「あなた個人のメアド」を推奨</strong>します。団体メアド（info@... 等）でも登録可ですが、団体への投稿はログイン後に「団体として」を選択する形なので、個人メアドのままで全機能利用できます</li>
                <li>ログインリンクは数分以内にメールで届きます（迷惑メールフォルダもご確認ください）</li>
                <li>同じメールアドレスへの送信は<strong>1時間に2通まで</strong>に制限されています。ボタンを連打せず、まず受信トレイをご確認ください</li>
                <li>すでに届いているリンクが未使用なら、そちらをそのままお使いいただけます</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100"
                placeholder="you@example.com"
                disabled={status === 'sending'}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={status === 'sending'}>
              {status === 'sending' ? '送信中…' : 'ログインリンクを送る'}
            </Button>

            <p className="text-xs text-slate-500 text-center pt-2">
              初めての方は自動でアカウント作成されます
            </p>
          </form>
        )}
      </main>
    </div>
  )
}
