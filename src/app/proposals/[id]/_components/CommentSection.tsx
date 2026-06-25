'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { postComment, likeComment } from '../../actions'

type Comment = {
  id: string
  author_id: string
  author_name: string
  kind: 'question' | 'answer' | 'comment'
  parent_id: string | null
  body: string
  likes: number
  created_at: string
  is_proposer: boolean
}

export function CommentSection({
  proposalId,
  proposerId,
  isLoggedIn,
  myUserId,
  myVoteChoice,
  comments,
}: {
  proposalId: string
  proposerId: string
  isLoggedIn: boolean
  myUserId: string | null
  myVoteChoice: string | null
  comments: Comment[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<'question' | 'comment'>('comment')
  const [body, setBody] = useState('')

  // 「わからない」投票者には質問動線を強調 (§3.3.4)
  const showQuestionPrompt =
    myVoteChoice === 'わからない' && kind !== 'question'

  // スレッド構造: 質問→（回答→コメント）／ ルートコメント（フラット）
  const questions = comments.filter((c) => c.kind === 'question' && !c.parent_id)
  const rootComments = comments.filter((c) => c.kind === 'comment' && !c.parent_id)
  const childrenOf = (id: string) =>
    comments.filter((c) => c.parent_id === id).sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

  // 質問は likes 多い順
  questions.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
  // ルートコメントは新しい順
  rootComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await postComment({ proposalId, kind, body })
        setBody('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-6">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">議論</h2>

      {showQuestionPrompt && (
        <div className="bg-sky-50 dark:bg-sky-950 border-l-4 border-sky-500 p-3 rounded text-sm">
          <p className="text-sky-900 dark:text-sky-100">
            「わからない」と投票しましたね。提案者に質問してみませんか？
          </p>
          <button
            type="button"
            className="text-xs text-sky-700 dark:text-sky-300 underline mt-1"
            onClick={() => setKind('question')}
          >
            質問モードに切替
          </button>
        </div>
      )}

      {/* 投稿フォーム */}
      {isLoggedIn ? (
        <form onSubmit={handleSubmit} className="space-y-3 border border-slate-200 dark:border-slate-800 rounded p-4">
          <div className="flex gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'comment'}
                onChange={() => setKind('comment')}
              />
              コメント（50字以上）
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'question'}
                onChange={() => setKind('question')}
              />
              質問（30字以上）
            </label>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={kind === 'question' ? '提案者への質問を入力（30字以上）' : '意見や補足を入力（50字以上）'}
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">{body.length} 字</span>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? '送信中…' : '投稿する'}
            </Button>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </form>
      ) : (
        <p className="text-sm text-slate-500 text-center py-4">
          議論に参加するには <a href={`/login?next=/proposals/${proposalId}`} className="underline">ログイン</a> してください
        </p>
      )}

      {/* 質問スレッド */}
      {questions.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase">質問（{questions.length}）</h3>
          {questions.map((q) => (
            <QuestionThread
              key={q.id}
              question={q}
              answers={childrenOf(q.id)}
              proposalId={proposalId}
              proposerId={proposerId}
              isLoggedIn={isLoggedIn}
              myUserId={myUserId}
              pending={pending}
              onLike={(id) => {
                startTransition(async () => {
                  await likeComment(id, proposalId)
                })
              }}
              onReply={async (parentId, replyBody) => {
                const ans = myUserId === proposerId ? 'answer' : 'comment'
                await postComment({
                  proposalId,
                  kind: ans,
                  body: replyBody,
                  parentId,
                })
              }}
            />
          ))}
        </div>
      )}

      {/* ルートコメント（フラット） */}
      {rootComments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase">コメント（{rootComments.length}）</h3>
          {rootComments.map((c) => (
            <CommentItem key={c.id} c={c} />
          ))}
        </div>
      )}

      {questions.length === 0 && rootComments.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">まだ議論はありません。最初に投稿してみませんか？</p>
      )}
    </section>
  )
}

function QuestionThread({
  question,
  answers,
  isLoggedIn,
  myUserId,
  proposerId,
  pending,
  onLike,
  onReply,
}: {
  question: Comment
  answers: Comment[]
  proposalId: string
  proposerId: string
  isLoggedIn: boolean
  myUserId: string | null
  pending: boolean
  onLike: (id: string) => void
  onReply: (parentId: string, body: string) => Promise<void>
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')

  return (
    <div className="border-l-2 border-amber-300 dark:border-amber-700 pl-3 space-y-2">
      <CommentItem c={question} questionMark />
      {isLoggedIn && (
        <div className="flex gap-3 text-xs text-slate-400">
          <button onClick={() => onLike(question.id)} disabled={pending} className="hover:text-amber-600">
            👍 いいね ({question.likes})
          </button>
          <button onClick={() => setReplyOpen((v) => !v)} className="hover:text-slate-700 dark:hover:text-slate-300">
            {replyOpen ? '閉じる' : '返信'}
          </button>
        </div>
      )}
      {replyOpen && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (replyBody.trim().length < 1) return
            await onReply(question.id, replyBody.trim())
            setReplyBody('')
            setReplyOpen(false)
          }}
          className="space-y-2 pl-3"
        >
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={2}
            placeholder={myUserId === proposerId ? '提案者として回答' : 'コメント'}
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-sm"
          />
          <Button type="submit" size="sm" variant="outline">送信</Button>
        </form>
      )}
      {answers.length > 0 && (
        <div className="ml-3 space-y-2 mt-2">
          {answers.map((a) => (
            <CommentItem key={a.id} c={a} />
          ))}
        </div>
      )}
    </div>
  )
}

function CommentItem({ c, questionMark }: { c: Comment; questionMark?: boolean }) {
  const baseColor =
    c.is_proposer
      ? 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
      : c.kind === 'question'
        ? 'bg-sky-50 dark:bg-sky-950 border-sky-200 dark:border-sky-800'
        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'

  const kindLabel = c.kind === 'question' ? '質問' : c.kind === 'answer' ? '回答' : 'コメント'

  return (
    <div className={`border rounded p-3 ${baseColor}`}>
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        {c.is_proposer && <span title="提案者">🌟</span>}
        <span className="font-medium text-slate-700 dark:text-slate-300">
          {c.author_name}
        </span>
        <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[10px]">
          {questionMark && c.kind === 'question' ? 'Q' : kindLabel}
        </span>
        <span className="ml-auto">{new Date(c.created_at).toLocaleString('ja-JP')}</span>
      </div>
      <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{c.body}</p>
    </div>
  )
}
