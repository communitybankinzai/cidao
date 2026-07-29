'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { voteChoiceMeta, STRONG_SUPPORT_CHOICE } from '@/lib/categories'
import { nameWithSan } from '@/lib/honorific'
import { castVote, retractVote } from '../../actions'
import { sendProposalSupportMessage } from '@/app/talent/actions'

export function VoteSection({
  proposalId,
  status,
  choices,
  myChoice,
  myDisclosed,
  isLoggedIn,
  isProposer,
  proposerName,
}: {
  proposalId: string
  status: string
  bindingType: string
  choices: string[]
  myChoice: string | null
  /** 自分の票が「大賛成 かつ 提案者に名乗る」になっているか */
  myDisclosed: boolean
  isLoggedIn: boolean
  isProposer: boolean
  proposerName: string | null
  aggregates: { tier: string; choice: string; count: number; weight_total: number }[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // 押した手応えを出すための表示状態。処理中はどのボタンを押したかを示し、
  // 完了後は数秒だけ「受け付けました」を出す（disabled だけでは反応が分からないため）
  const [busyChoice, setBusyChoice] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [disclose, setDisclose] = useState(myDisclosed)

  // 「押した時点で完了」を即座に見せるため、投票状態はマウント時に props を
  // 初期値として取り込み、以後は操作結果でローカルに更新する
  // （サーバー再取得を待たずに表示が変わる）
  const [effectiveChoice, setEffectiveChoice] = useState<string | null>(myChoice)
  const [effectiveDisclosed, setEffectiveDisclosed] = useState(myDisclosed)

  function applyVoted(choice: string | null, disclosed: boolean) {
    setEffectiveChoice(choice)
    setEffectiveDisclosed(disclosed)
  }

  // server action は失敗理由を戻り値で返す（本番ビルドでは例外の本文が
  // クライアントに渡らないため）。想定外の例外も一応拾う
  function run(
    label: string,
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    onSuccess?: () => void
  ) {
    setError(null)
    setDone(null)
    setBusyChoice(label)
    startTransition(async () => {
      try {
        const result = await fn()
        if (!result.ok) {
          setError(result.error)
          return
        }
        onSuccess?.()
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

  if (isProposer) {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-center">
        <p className="text-sm text-slate-500">自分の提案には投票できません</p>
      </section>
    )
  }

  const strongSupportSelected = effectiveChoice === STRONG_SUPPORT_CHOICE

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">あなたの投票</h2>
      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice) => {
          const selected = effectiveChoice === choice
          const desc = voteChoiceMeta(choice)?.desc
          return (
            <Button
              key={choice}
              variant={selected ? 'default' : 'outline'}
              disabled={pending}
              aria-busy={busyChoice === choice}
              onClick={() => run(
                choice,
                () => castVote(proposalId, choice, disclose),
                () => applyVoted(choice, choice === STRONG_SUPPORT_CHOICE && disclose)
              )}
              className="h-auto flex-col gap-0.5 whitespace-normal py-2.5 text-center"
            >
              <span className="text-sm font-semibold">
                {busyChoice === choice ? '送信中…' : choice}
              </span>
              {desc && <span className="text-[11px] font-normal opacity-75">{desc}</span>}
            </Button>
          )
        })}
      </div>

      {/* 名乗り出しの選択。大賛成のときだけ意味を持つ */}
      <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={disclose}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked
            setDisclose(next)
            // 既に大賛成で投票済みなら、その場で名乗り状態を更新する
            if (strongSupportSelected) {
              run(
                STRONG_SUPPORT_CHOICE,
                () => castVote(proposalId, STRONG_SUPPORT_CHOICE, next),
                () => applyVoted(STRONG_SUPPORT_CHOICE, next)
              )
            }
          }}
          className="mt-0.5"
        />
        <span>
          「大賛成」で投票するとき、提案者{proposerName ? `（${nameWithSan(proposerName)}）` : ''}に
          <span className="font-medium text-slate-800 dark:text-slate-200">名前を伝えて</span>
          メッセージのやりとりができるようにする
          <span className="block text-[11px] text-slate-400 mt-0.5">
            チェックしない場合、誰が投票したかは提案者にも分かりません。他の選択肢では名前は伝わりません。
          </span>
        </span>
      </label>

      {effectiveChoice ? (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                ✓ 投票済みです：{effectiveChoice}
              </p>
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-400/80 mt-0.5">
                ボタンを押した時点で投票は完了しています。投票期間中は何度でも選び直せます。
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(
                '撤回',
                () => retractVote(proposalId),
                () => applyVoted(null, false)
              )}
              className="shrink-0 text-xs text-emerald-700/70 dark:text-emerald-400/70 hover:text-rose-500 underline"
            >
              {busyChoice === '撤回' ? '撤回中…' : '投票を撤回'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          ボタンを押すと、その場で投票が確定します（投票期間中はいつでも選び直せます）。
        </p>
      )}
      {done === '撤回' && (
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
          ✓ 投票を取り消しました
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}

      {strongSupportSelected && effectiveDisclosed && (
        <SupportMessageForm proposalId={proposalId} proposerName={proposerName} />
      )}
    </section>
  )
}

/**
 * 大賛成で名乗り出た人から提案者へのメッセージ。
 * 送信後のやりとりは既存の「届いた声がけ」受信箱（/me/inbox）で続く。
 */
function SupportMessageForm({
  proposalId,
  proposerName,
}: {
  proposalId: string
  proposerName: string | null
}) {
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const trimmed = message.trim()
    if (trimmed.length < 1) {
      setError('メッセージを入力してください')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const result = await sendProposalSupportMessage(proposalId, trimmed)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setMessage('')
        setSent(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        提案者{proposerName ? `（${nameWithSan(proposerName)}）` : ''}にメッセージを送る（任意）
      </p>
      <p className="text-[11px] text-slate-400">
        投票はすでに完了しています。送らなくても「大賛成」の票と名乗り出は記録されています。
        どんな形で協力できそうか伝えると話が進みます。返信は
        <a href="/me/inbox" className="underline mx-0.5">受信箱</a>
        に届きます。
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={600}
        rows={3}
        disabled={pending}
        placeholder="例：週末なら会場設営を手伝えます。まず一度お話しできますか。"
        className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{message.length}/600</span>
        <Button size="sm" disabled={pending} onClick={submit}>
          {pending ? '送信中…' : 'メッセージを送る'}
        </Button>
      </div>
      {sent && (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          ✓ 送信しました。返信は受信箱に届きます
        </p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}
