'use client'

// 決裁の起案フォーム。非エンジニアの役員がフォーム入力だけで完結できるようにする。
// 添付ファイルは非公開バケット approval-attachments へブラウザから直接アップロードする
// （Server Actions の 1MB ボディ制限を避けるため。バケットは RLS で役員のみ書き込み可）。

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ATTACHMENT_BUCKET } from '@/lib/approval'
import { createRequest, type AttachmentInput } from '../actions'

export type CategoryOption = {
  category: string
  label: string
  description: string
  approverNames: string
  thresholdAmount: number | null
  deadlineDays: number
  excludeInvolved: boolean
}

const MAX_FILE_MB = 10
const MAX_FILES = 10

function fileExt(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : ''
  return /^[a-zA-Z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : 'bin'
}

export function RequestForm({
  categories,
  officerOptions,
}: {
  categories: CategoryOption[]
  officerOptions: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(categories[0]?.category ?? '')
  const [body, setBody] = useState('')
  const [amount, setAmount] = useState('')
  const [conflictNote, setConflictNote] = useState('')
  const [conflictIds, setConflictIds] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'saving'>('idle')

  const current = categories.find((c) => c.category === category)
  const isExpense = category === 'expense'
  const isConflict = category === 'conflict_of_interest'

  const inputCls =
    'w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm'
  const labelCls = 'block text-sm font-semibold mb-1'
  const hintCls = 'text-xs text-slate-500 mt-1'

  const submit = () => {
    setError('')
    if (!title.trim()) { setError('件名を入力してください'); return }
    if (!body.trim()) { setError('本文を入力してください'); return }
    if (isExpense && !/^\d+$/.test(amount.trim())) { setError('金額を半角数字で入力してください（円）'); return }
    if (isConflict && !conflictNote.trim()) { setError('利益相反の関係の内容を記入してください'); return }
    for (const f of files) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`「${f.name}」が大きすぎます（${MAX_FILE_MB}MBまで）`); return
      }
    }

    startTransition(async () => {
      try {
        // 1. 添付を非公開バケットへアップロード（役員のみ書き込み可）
        setPhase('uploading')
        const supabase = createClient()
        const dir = crypto.randomUUID()
        const attachments: AttachmentInput[] = []
        for (const f of files.slice(0, MAX_FILES)) {
          const path = `${dir}/${crypto.randomUUID()}.${fileExt(f.name)}`
          const { error: upErr } = await supabase.storage
            .from(ATTACHMENT_BUCKET)
            .upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' })
          if (upErr) throw new Error(`添付「${f.name}」のアップロードに失敗しました: ${upErr.message}`)
          attachments.push({ path, name: f.name, size: f.size })
        }

        // 2. 起案を登録
        setPhase('saving')
        const res = await createRequest({
          title: title.trim(),
          category,
          body: body.trim(),
          amount: isExpense ? Number(amount.trim()) : null,
          conflictNote: conflictNote.trim(),
          conflictOfficerIds: conflictIds,
          attachments,
        })
        if (!res.ok) { setError(res.error); setPhase('idle'); return }
        router.push(res.id ? `/admin/approvals/${res.id}` : '/admin/approvals')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setPhase('idle')
      }
    })
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5">
      <div>
        <label className={labelCls}>件名 <span className="text-red-600">＊</span></label>
        <input
          type="text" value={title} maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 文化財タイムトライアル大会の実施について"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>決裁区分 <span className="text-red-600">＊</span></label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>{c.label}</option>
          ))}
        </select>
        {current && (
          <div className="mt-2 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded p-3 space-y-1">
            <p className="text-slate-600 dark:text-slate-300">{current.description}</p>
            <p>
              <b>必要な承認者:</b>{' '}
              {current.excludeInvolved ? '当事者を除く役員全員（監査役を除く）' : current.approverNames}
            </p>
            {current.thresholdAmount !== null && (
              <p><b>対象:</b> 1件 {current.thresholdAmount.toLocaleString('ja-JP')}円以上の支出、および予算外の支出</p>
            )}
            <p><b>決裁期限:</b> 起案から{current.deadlineDays}日（期限を過ぎても自動では承認されません）</p>
          </div>
        )}
      </div>

      {isExpense && (
        <div>
          <label className={labelCls}>金額（円） <span className="text-red-600">＊</span></label>
          <input
            type="text" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="例: 15000"
            className={inputCls + ' max-w-[12rem]'}
          />
          <p className={hintCls}>本文に金額の内訳（積算の根拠）も書いてください。</p>
        </div>
      )}

      {isConflict && (
        <div className="space-y-3 border border-amber-300 dark:border-amber-700 rounded p-3 bg-amber-50 dark:bg-amber-950/30">
          <div>
            <label className={labelCls}>利益相反の関係の内容 <span className="text-red-600">＊</span></label>
            <textarea
              value={conflictNote} rows={2} maxLength={1000}
              onChange={(e) => setConflictNote(e.target.value)}
              placeholder="例: 発注先の N's factory は起案者が代表を務める事業者"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>起案者以外に当事者となる役員（いれば選択）</label>
            <div className="space-y-1">
              {officerOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={conflictIds.includes(o.id)}
                    onChange={(e) =>
                      setConflictIds((prev) =>
                        e.target.checked ? [...prev, o.id] : prev.filter((id) => id !== o.id)
                      )
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <p className={hintCls}>
              起案者（あなた）は自動的に当事者になります。当事者は承認に参加できず、残りの役員だけで決裁します。
            </p>
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>本文 <span className="text-red-600">＊</span></label>
        <textarea
          value={body} rows={10} maxLength={10000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'決めてほしいこと・理由・時期などを書いてください。\nここに直接書けば、ファイルの添付は不要です。'}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>添付ファイル（任意）</label>
        <input
          type="file" multiple
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-sm"
        />
        <p className={hintCls}>
          Word・PDF・Excel・画像（1件{MAX_FILE_MB}MBまで・{MAX_FILES}件まで）。
          紙の見積書や領収書はスマホで撮った写真でOKです。役員以外は閲覧できません。
        </p>
        {files.length > 0 && (
          <ul className="mt-1 text-xs text-slate-500 list-disc list-inside">
            {files.map((f) => <li key={f.name}>{f.name}（{(f.size / 1024 / 1024).toFixed(1)}MB）</li>)}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-600">⚠ {error}</p>}

      <button
        type="button" disabled={pending} onClick={submit}
        className="px-6 py-2.5 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {phase === 'uploading' ? '添付をアップロード中…' : phase === 'saving' ? '起案を登録中…' : '起案する'}
      </button>
      <p className="text-xs text-slate-500">
        起案すると承認者に回付され、押印状況は詳細画面でいつでも確認できます。
      </p>
    </div>
  )
}
