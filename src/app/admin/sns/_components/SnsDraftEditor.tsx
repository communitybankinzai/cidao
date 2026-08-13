'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { regenerateDraft, saveDraft, approveDraft, unapproveDraft } from '../actions'

export type DraftLog = {
  id: string
  target_type: 'freefree' | 'event' | 'org' | 'proposal'
  target_id: string
  medium: 'x' | 'facebook' | 'line' | 'threads' | 'instagram'
  content: string | null
  approved_at: string | null
  created_at: string
  title: string
  mediumLabel: string
  targetLabel: string
}

// X は 280 weighted（日本語などは1字2カウント、URL は長さに関わらず23）
function xWeight(s: string): number {
  const urls = s.match(/https?:\/\/\S+/g) ?? []
  let rest = s
  for (const u of urls) rest = rest.replace(u, '')
  let w = urls.length * 23
  for (const ch of rest) w += /[\x00-\x7F]/.test(ch) ? 1 : 2
  return w
}

export default function SnsDraftEditor({ log }: { log: DraftLog }) {
  const [text, setText] = useState(log.content ?? '')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const approved = !!log.approved_at

  function run(fn: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const weight = xWeight(text)
  const overLimit = log.medium === 'x' && weight > 280

  return (
    <li className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="shrink-0">{log.targetLabel}</span>
        <span className="shrink-0">{log.mediumLabel}</span>
        <span className="flex-1 truncate font-medium text-slate-700 dark:text-slate-300">{log.title}</span>
        {approved ? (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            ✓ 承認済み（配信待ち）
          </span>
        ) : (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            未承認（配信されません）
          </span>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="「下書きを作る」を押すと、掲載内容からテンプレートで本文を生成します"
        className="w-full text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] ${overLimit ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
          {log.medium === 'x' ? `X換算 ${weight} / 280${overLimit ? '（超過。このままでは投稿できません）' : ''}` : `${text.length} 字`}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => run(async () => {
            // 生成結果をそのまま画面へ入れる。
            // 再描画では useState の初期値が読み直されないため、戻り値で反映する
            setText(await regenerateDraft(log.id))
          })}
        >
          {log.content ? '下書きを作り直す' : '下書きを作る'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !text.trim()}
          onClick={() => run(() => saveDraft(log.id, text))}
        >
          保存
        </Button>
        {approved ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => unapproveDraft(log.id))}>
            承認を取り消す
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending || !text.trim() || overLimit}
            onClick={() => run(() => approveDraft(log.id, text))}
          >
            承認して配信可にする
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {pending && <p className="text-xs text-slate-500">処理中…</p>}
    </li>
  )
}
