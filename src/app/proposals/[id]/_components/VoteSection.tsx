'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { castVote, retractVote } from '../../actions'

export function VoteSection({
  proposalId,
  status,
  choices,
  myChoice,
  isLoggedIn,
}: {
  proposalId: string
  status: string
  bindingType: string
  choices: string[]
  myChoice: string | null
  isLoggedIn: boolean
  aggregates: { tier: string; choice: string; count: number; weight_total: number }[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // 押した手応えを出すための表示状態。処理中はどのボタンを押したかを示し、
  // 完了後は数秒だけ「受け付けました」を出す（disabled だけでは反応が分からないため）
  const [busyChoice, setBusyChoice] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function run(label: string, fn: () => Promise<void>) {
    setError(null)
    setDone(null)
    setBusyChoice(label)
    startTransition(async () => {
      try {
        await fn()
        setDone(label)
        setTimeout(() => setDone(null), 4000)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyChoice(null)
      }
    })
  }

  if (status === 'discussion') {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-center">
        <p className="text-sm text-slate-500">議論期間中のため、まだ投票は開始されていません</p>
      </section>
    )
  }

  if (status !== 'voting') {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-center">
        <p className="text-sm text-slate-500">投票期間は終了しました</p>
        {myChoice && (
          <p className="text-xs text-slate-400 mt-2">あなたの最終投票: <span className="font-mono">{myChoice}</span></p>
        )}
      </section>
    )
  }

  if (!isLoggedIn) {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-center space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">投票するにはログインが必要です</p>
        <a href={`/login?next=/proposals/${proposalId}`}>
          <Button>ログイン</Button>
        </a>
      </section>
    )
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">あなたの投票</h2>
      <div className="grid grid-cols-3 gap-2">
        {choices.map((choice) => {
          const selected = myChoice === choice
          return (
            <Button
              key={choice}
              variant={selected ? 'default' : 'outline'}
              disabled={pending}
              aria-busy={busyChoice === choice}
              onClick={() => run(choice, () => castVote(proposalId, choice))}
            >
              {busyChoice === choice ? '送信中…' : choice}
            </Button>
          )
        })}
      </div>
      {myChoice && (
        <div className="flex justify-between items-center text-xs text-slate-500">
          <span>選択中: <span className="font-mono text-slate-700 dark:text-slate-300">{myChoice}</span>（投票期間中はいつでも変更可）</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run('撤回', () => retractVote(proposalId))}
            className="text-slate-400 hover:text-rose-500 underline"
          >
            {busyChoice === '撤回' ? '撤回中…' : '投票を撤回'}
          </button>
        </div>
      )}
      {done && (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {done === '撤回' ? '✓ 投票を取り消しました' : `✓ 「${done}」で投票を受け付けました`}
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}
    </section>
  )
}
