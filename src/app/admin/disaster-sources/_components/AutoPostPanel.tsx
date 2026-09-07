'use client'

// 警戒レベルによる自動SNS投稿の設定と履歴。
// 誤って発報すると取り返しがつかないので、既定は「止まっている」状態。
// 有効にするときは、何が起きるかを画面で読んでから押せるようにしてある。

import { useState, useTransition } from 'react'
import { saveAutoPostConfig } from '../actions'

export type AutoPostView = {
  enabled: boolean
  autoLevel: number
  approvalLevel: number
  minIntervalMinutes: number
  media: string[]
  state: {
    level?: number
    updatedAt?: string
    lastPostedAt?: string
    history?: Array<{ at: string; level: number; kind: string; result?: unknown }>
  } | null
}

const KIND_LABEL: Record<string, string> = {
  posted: '自動投稿',
  approval: '承認待ちを作成',
  cancelled: '解除を投稿',
}

function jst(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AutoPostPanel({ initial }: { initial: AutoPostView }) {
  const [form, setForm] = useState(initial)
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()

  const submit = (next: Partial<AutoPostView>) => {
    const merged = { ...form, ...next }
    setForm(merged)
    setMessage('')
    start(async () => {
      const res = await saveAutoPostConfig({
        enabled: merged.enabled,
        autoLevel: merged.autoLevel,
        approvalLevel: merged.approvalLevel,
        minIntervalMinutes: merged.minIntervalMinutes,
        media: merged.media,
      })
      setMessage(res.ok ? '保存しました' : `保存できません：${res.error}`)
    })
  }

  const history = form.state?.history ?? []

  return (
    <section className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">🚨 警戒レベルによる自動SNS投稿</h2>
          <p className="text-xs text-slate-500 mt-1">
            10分ごとの巡回で印西市の警戒レベルが上がったとき、SNSへ自動で知らせます。
            レベルの根拠にするのは<strong>印西市に出ていることが確実な情報源だけ</strong>で、
            千葉県全体・全国向けの情報は使いません。
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={pending}
            onChange={(e) => submit({ enabled: e.target.checked })}
          />
          <span className={form.enabled ? 'text-rose-600 font-bold' : 'text-slate-500'}>
            {form.enabled ? '稼働中' : '停止中'}
          </span>
        </label>
      </div>

      <div className="rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
        <p className="font-bold">有効にすると何が起きるか</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>レベル{form.autoLevel}以上になったとき、<strong>人の確認なしにSNSへ投稿</strong>します</li>
          <li>レベル{form.approvalLevel}のときは投稿せず、承認用のリンクを作ります</li>
          <li>本文は公式の文章をそのまま引用し、「公式発表ではない」旨を必ず付けます</li>
          <li>レベルが<strong>上がったときだけ</strong>出します。同じ状態が続く間は黙ります</li>
          <li>レベル{form.autoLevel}以上から下がったときは、解除を自動で知らせます</li>
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-slate-500">自動で投稿するレベル</span>
          <select
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1"
            value={form.autoLevel}
            disabled={pending}
            onChange={(e) => submit({ autoLevel: Number(e.target.value) })}
          >
            {[3, 4, 5].map((n) => <option key={n} value={n}>レベル{n}以上</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-slate-500">承認待ちを作るレベル</span>
          <select
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1"
            value={form.approvalLevel}
            disabled={pending}
            onChange={(e) => submit({ approvalLevel: Number(e.target.value) })}
          >
            {[3, 4, 5].map((n) => <option key={n} value={n}>レベル{n}以上</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-slate-500">最短の間隔（分）</span>
          <input
            type="number" min={5} max={360}
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1"
            value={form.minIntervalMinutes}
            disabled={pending}
            onChange={(e) => setForm({ ...form, minIntervalMinutes: Number(e.target.value) })}
            onBlur={(e) => submit({ minIntervalMinutes: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="text-sm">
        <span className="text-xs text-slate-500 block mb-1">投稿先</span>
        <div className="flex gap-4">
          {(['threads', 'instagram'] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.media.includes(m)}
                disabled={pending}
                onChange={(e) =>
                  submit({ media: e.target.checked ? [...form.media, m] : form.media.filter((x) => x !== m) })
                }
              />
              {m === 'threads' ? 'Threads' : 'Instagram'}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Instagram は画像が必須のため、自動投稿では Threads のみを推奨します。
        </p>
      </div>

      <div className="text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-3">
        いまの判定レベル：<strong>{form.state?.level ?? 0}</strong>
        （{jst(form.state?.updatedAt)} 時点）／ 最後の自動投稿：{jst(form.state?.lastPostedAt)}
      </div>

      {history.length > 0 && (
        <div className="text-xs">
          <p className="text-slate-500 mb-1">履歴（新しい順・最大50件）</p>
          <ul className="space-y-1 max-h-56 overflow-y-auto">
            {history.map((h, i) => (
              <li key={i} className="flex gap-2 border-b border-slate-100 dark:border-slate-800 pb-1">
                <span className="text-slate-500 whitespace-nowrap">{jst(h.at)}</span>
                <span className="whitespace-nowrap">レベル{h.level}</span>
                <span className="whitespace-nowrap">{KIND_LABEL[h.kind] ?? h.kind}</span>
                <span className="text-slate-500 truncate">{h.result ? JSON.stringify(h.result).slice(0, 90) : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="text-xs text-slate-600 dark:text-slate-300">{message}</p>}
    </section>
  )
}
