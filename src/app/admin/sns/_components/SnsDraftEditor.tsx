'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { regenerateDraft, saveDraft, approveDraft, unapproveDraft, dismissDraft, approveAndDispatchDraft } from '../actions'

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

// 自動配信は毎日 JST 18時台（Vercel Cron: 09:00 UTC）。vercel.json と揃えること。
// Vercel の Hobby プランは実行に最大1時間の猶予があるため、
// 「18:00ちょうど」ではなく「18時台」と案内する
const DISPATCH_HOUR_JST = 18

// 次に自動配信が走るタイミングを「本日18時台」「明日18時台」の形で返す。
// 端末のタイムゾーンに影響されないよう JST(+9) で計算する
function nextDispatchLabel(): string {
  const nowJst = new Date(Date.now() + 9 * 3600_000) // UTC基準の値をJSTの壁時計として読む
  const isToday = nowJst.getUTCHours() < DISPATCH_HOUR_JST
  return `${isToday ? '本日' : '明日'}${DISPATCH_HOUR_JST}時台`
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

  function run(fn: () => Promise<{ ok: boolean; content?: string; error?: string } | void>) {
    setError(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (r && !r.ok) setError(r.error ?? '失敗しました')
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
            ✓ 承認済み — {nextDispatchLabel()}に自動配信
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
            const r = await regenerateDraft(log.id)
            if (r.ok && r.content) setText(r.content)
            return r
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
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="text-red-600 hover:text-red-700"
              onClick={() => {
                if (!window.confirm(`「${log.title}」（${log.mediumLabel}）の下書きを却下してリストから消します。よろしいですか？`)) return
                run(() => dismissDraft(log.id))
              }}
            >
              却下
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !text.trim() || overLimit}
              onClick={() => run(() => approveDraft(log.id, text))}
            >
              承認する（{nextDispatchLabel()}に配信）
            </Button>
            <Button
              type="button"
              disabled={pending || !text.trim() || overLimit}
              onClick={() => {
                if (!window.confirm(`「${log.title}」（${log.mediumLabel}）をこの内容でただちに投稿します。よろしいですか？`)) return
                run(() => approveAndDispatchDraft(log.id, text))
              }}
            >
              ⚡ 今すぐ投稿
            </Button>
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {pending && <p className="text-xs text-slate-500">処理中…</p>}
    </li>
  )
}
