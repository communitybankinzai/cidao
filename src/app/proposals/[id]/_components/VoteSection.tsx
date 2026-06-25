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
              onClick={() => {
                setError(null)
                startTransition(async () => {
                  try {
                    await castVote(proposalId, choice)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  }
                })
              }}
            >
              {choice}
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
            onClick={() => {
              setError(null)
              startTransition(async () => {
                try {
                  await retractVote(proposalId)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              })
            }}
            className="text-slate-400 hover:text-rose-500 underline"
          >
            投票を撤回
          </button>
        </div>
      )}
      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}
    </section>
  )
}
