'use client'

import { useState, useTransition } from 'react'
import {
  createManualItem,
  createSource,
  deleteSource,
  runTimelineNow,
  setSourceEnabled,
  testFetchDraftSource,
  testFetchSavedSource,
  type PreviewItem,
  type SourceInput,
} from '../actions'
import type { SourceRunResult, SourceTrust } from '@/lib/disaster-timeline'

export type SourceRow = {
  id: string
  kind: string
  label: string
  url: string
  config: Record<string, unknown>
  trust: SourceTrust
  enabled: boolean
  lastFetchedAt: string | null
  lastStatus: string | null
  lastError: string | null
  itemCount: number
}

type KindOption = { id: string; label: string; help: string }

type LastRun = { started_at: string; finished_at: string | null; status: string; error_message: string | null } | null

const TRUST_LABEL: Record<SourceTrust, string> = {
  official: '公式',
  'semi-official': '準公式',
  unverified: '未確認',
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  failed: '失敗',
  running: '実行中',
  partial: '一部失敗',
  skipped: 'スキップ',
}

function formatJst(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const inputClass = 'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950'
const buttonClass = 'text-xs px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40'
const primaryButtonClass = 'text-xs px-3 py-2 rounded border border-sky-700 bg-sky-700 text-white disabled:opacity-40'

function PreviewList({ total, items }: { total: number; items: PreviewItem[] }) {
  if (total === 0) return <p className="text-xs text-slate-500 mt-2">取得結果：0件（エラーなし）</p>
  return (
    <div className="mt-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
      <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">取得結果：{total}件（先頭{items.length}件を表示・DBには保存していません）</p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${item.occurredAt}-${index}`} className="text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="font-mono text-slate-500">{formatJst(item.occurredAt)}</span>
              <span className="font-medium">{item.title}</span>
            </div>
            {item.body && <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{item.body}</p>}
            {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-sky-700 dark:text-sky-400 break-all hover:underline">{item.url}</a>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function DisasterSourcesManager({
  initialSources,
  kinds,
  lastRun,
  disabled,
}: {
  initialSources: SourceRow[]
  kinds: KindOption[]
  lastRun: LastRun
  disabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [preview, setPreview] = useState<{ id: string; total: number; items: PreviewItem[] } | null>(null)
  const [runResults, setRunResults] = useState<SourceRunResult[] | null>(null)

  const [form, setForm] = useState<SourceInput>({
    kind: kinds[0]?.id ?? 'city-category-html',
    label: '',
    url: '',
    configJson: '{}',
    trust: 'official',
    enabled: true,
  })
  const [formPreview, setFormPreview] = useState<{ total: number; items: PreviewItem[] } | null>(null)

  const manualSources = initialSources.filter((source) => source.kind === 'manual')
  const [manual, setManual] = useState({
    sourceId: manualSources[0]?.id ?? '',
    occurredAt: '',
    title: '',
    body: '',
    url: '',
    trust: 'official' as SourceTrust,
  })

  function reset() {
    setMessage('')
    setError('')
  }

  function validateConfigJson(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return true
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
    } catch {
      return false
    }
  }

  function submitSource() {
    reset()
    if (!validateConfigJson(form.configJson)) {
      setError('config は JSON オブジェクト形式で入力してください（例: {"baseUrl":"https://..."}）')
      return
    }
    startTransition(async () => {
      const result = await createSource(form)
      if (result.ok) {
        setMessage('情報源を追加しました。')
        setForm((current) => ({ ...current, label: '', url: '', configJson: '{}' }))
        setFormPreview(null)
      } else {
        setError(result.error)
      }
    })
  }

  function testDraft() {
    reset()
    if (!validateConfigJson(form.configJson)) {
      setError('config は JSON オブジェクト形式で入力してください')
      return
    }
    setFormPreview(null)
    startTransition(async () => {
      const result = await testFetchDraftSource(form)
      if (result.ok && result.data) setFormPreview(result.data)
      else if (!result.ok) setError(result.error)
    })
  }

  function testSaved(id: string) {
    reset()
    setBusyId(id)
    setPreview(null)
    startTransition(async () => {
      const result = await testFetchSavedSource(id)
      setBusyId('')
      if (result.ok && result.data) setPreview({ id, ...result.data })
      else if (!result.ok) setError(result.error)
    })
  }

  function toggle(source: SourceRow) {
    reset()
    setBusyId(source.id)
    startTransition(async () => {
      const result = await setSourceEnabled(source.id, !source.enabled)
      setBusyId('')
      if (result.ok) setMessage(`「${source.label}」を${source.enabled ? '停止' : '有効化'}しました。`)
      else setError(result.error)
    })
  }

  function remove(source: SourceRow) {
    if (!window.confirm(`「${source.label}」を削除します。取得済みの項目（${source.itemCount}件）も一緒に消えます。よろしいですか？`)) return
    reset()
    setBusyId(source.id)
    startTransition(async () => {
      const result = await deleteSource(source.id)
      setBusyId('')
      if (result.ok) setMessage(`「${source.label}」を削除しました。`)
      else setError(result.error)
    })
  }

  function runNow() {
    reset()
    setRunResults(null)
    startTransition(async () => {
      const result = await runTimelineNow()
      if (result.ok && result.data) {
        setRunResults(result.data.results)
        setMessage(`巡回が完了しました（${STATUS_LABEL[result.data.status] ?? result.data.status}）。`)
      } else if (!result.ok) {
        setError(result.error)
      }
    })
  }

  function submitManual() {
    reset()
    startTransition(async () => {
      const result = await createManualItem(manual)
      if (result.ok) {
        setMessage('手動項目を登録しました。')
        setManual((current) => ({ ...current, title: '', body: '', url: '' }))
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap">{error}</p>}

      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold">登録済み情報源</h2>
            <p className="text-xs text-slate-500 mt-1">
              最終巡回：{lastRun ? `${formatJst(lastRun.started_at)}（${STATUS_LABEL[lastRun.status] ?? lastRun.status}）` : '未実行'}
              {lastRun?.error_message ? ` / ${lastRun.error_message}` : ''}
            </p>
          </div>
          <button type="button" onClick={runNow} disabled={disabled || pending} className={primaryButtonClass}>
            {pending ? '処理中...' : '今すぐ巡回'}
          </button>
        </div>

        {runResults && (
          <div className="mb-4 rounded border border-slate-200 dark:border-slate-800 p-3 text-xs">
            <p className="font-medium mb-1">巡回結果</p>
            <ul className="space-y-1">
              {runResults.map((result) => (
                <li key={result.sourceId} className={result.status === 'failed' ? 'text-red-700 dark:text-red-400' : ''}>
                  {result.label}：{STATUS_LABEL[result.status] ?? result.status}
                  {result.status === 'success'
                    ? `（取得${result.fetched} / 新規${result.inserted} / 更新${result.updated} / 変化なし${result.unchanged}）`
                    : ` ${result.error ?? ''}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 pr-2">表示名</th>
                <th className="py-2 pr-2">種別</th>
                <th className="py-2 pr-2">信頼度</th>
                <th className="py-2 pr-2">状態</th>
                <th className="py-2 pr-2">最終取得</th>
                <th className="py-2 pr-2">結果</th>
                <th className="py-2 pr-2">件数</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {initialSources.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-slate-500">情報源がありません</td></tr>
              )}
              {initialSources.map((source) => (
                <tr key={source.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{source.label}</div>
                    {source.url && <a href={source.url} target="_blank" rel="noreferrer" className="text-[11px] text-sky-700 dark:text-sky-400 break-all hover:underline">{source.url}</a>}
                    {preview?.id === source.id && <PreviewList total={preview.total} items={preview.items} />}
                  </td>
                  <td className="py-2 pr-2 font-mono">{source.kind}</td>
                  <td className="py-2 pr-2">{TRUST_LABEL[source.trust] ?? source.trust}</td>
                  <td className="py-2 pr-2">{source.enabled ? '有効' : '停止'}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{formatJst(source.lastFetchedAt)}</td>
                  <td className="py-2 pr-2">
                    {source.lastStatus ? (STATUS_LABEL[source.lastStatus] ?? source.lastStatus) : '-'}
                    {source.lastError && <div className="text-red-700 dark:text-red-400 break-all max-w-xs">{source.lastError}</div>}
                  </td>
                  <td className="py-2 pr-2 text-right">{source.itemCount}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className={buttonClass} disabled={pending || source.kind === 'manual'} onClick={() => testSaved(source.id)}>
                        {busyId === source.id && pending ? '取得中...' : 'テスト取得'}
                      </button>
                      <button type="button" className={buttonClass} disabled={pending} onClick={() => toggle(source)}>
                        {source.enabled ? '停止する' : '有効にする'}
                      </button>
                      <button type="button" className={`${buttonClass} text-red-700 dark:text-red-400`} disabled={pending} onClick={() => remove(source)}>
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
        <h2 className="text-lg font-semibold mb-1">情報源を追加</h2>
        <p className="text-xs text-slate-500 mb-4">保存前に「テスト取得」で取り込める内容を確認できます。</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium">
            種別
            <select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))} className={inputClass}>
              {kinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
            </select>
            <span className="mt-1 block text-[11px] font-normal text-slate-500">{kinds.find((kind) => kind.id === form.kind)?.help}</span>
          </label>
          <label className="block text-sm font-medium">
            表示名
            <input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} className={inputClass} placeholder="印西市 防災情報" />
          </label>
          <label className="block text-sm font-medium md:col-span-2">
            URL
            <input value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} className={inputClass} placeholder="https://..." />
          </label>
          <label className="block text-sm font-medium md:col-span-2">
            config（JSON）
            <textarea rows={3} value={form.configJson} onChange={(event) => setForm((current) => ({ ...current, configJson: event.target.value }))} className={`${inputClass} font-mono`} />
            {!validateConfigJson(form.configJson) && <span className="mt-1 block text-[11px] font-normal text-red-700 dark:text-red-400">JSON として読めません</span>}
          </label>
          <label className="block text-sm font-medium">
            信頼度
            <select value={form.trust} onChange={(event) => setForm((current) => ({ ...current, trust: event.target.value as SourceTrust }))} className={inputClass}>
              {(Object.keys(TRUST_LABEL) as SourceTrust[]).map((trust) => <option key={trust} value={trust}>{TRUST_LABEL[trust]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium mt-6">
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
            有効（巡回対象にする）
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={testDraft} disabled={disabled || pending} className={buttonClass}>テスト取得</button>
          <button type="button" onClick={submitSource} disabled={disabled || pending} className={primaryButtonClass}>情報源を保存</button>
        </div>
        {formPreview && <PreviewList total={formPreview.total} items={formPreview.items} />}
      </section>

      <section className="bg-white dark:bg-slate-900 border rounded-lg p-5">
        <h2 className="text-lg font-semibold mb-1">手動で項目を登録</h2>
        <p className="text-xs text-slate-500 mb-4">
          市公式LINEの配信文など、自動取得できない発表を貼り付けて登録します。
          {manualSources.length === 0 && ' 先に種別「手動登録」の情報源を追加してください。'}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium">
            登録先（手動登録の情報源）
            <select value={manual.sourceId} onChange={(event) => setManual((current) => ({ ...current, sourceId: event.target.value }))} className={inputClass}>
              {manualSources.length === 0 && <option value="">（なし）</option>}
              {manualSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            発生日時（JST）
            <input type="datetime-local" value={manual.occurredAt} onChange={(event) => setManual((current) => ({ ...current, occurredAt: event.target.value }))} className={inputClass} />
          </label>
          <label className="block text-sm font-medium md:col-span-2">
            タイトル
            <input value={manual.title} onChange={(event) => setManual((current) => ({ ...current, title: event.target.value }))} className={inputClass} placeholder="市公式LINE：避難所開設のお知らせ" />
          </label>
          <label className="block text-sm font-medium md:col-span-2">
            本文
            <textarea rows={5} value={manual.body} onChange={(event) => setManual((current) => ({ ...current, body: event.target.value }))} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            URL（任意）
            <input value={manual.url} onChange={(event) => setManual((current) => ({ ...current, url: event.target.value }))} className={inputClass} placeholder="https://..." />
          </label>
          <label className="block text-sm font-medium">
            信頼度
            <select value={manual.trust} onChange={(event) => setManual((current) => ({ ...current, trust: event.target.value as SourceTrust }))} className={inputClass}>
              {(Object.keys(TRUST_LABEL) as SourceTrust[]).map((trust) => <option key={trust} value={trust}>{TRUST_LABEL[trust]}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4">
          <button type="button" onClick={submitManual} disabled={disabled || pending || !manual.sourceId} className={primaryButtonClass}>項目を登録</button>
        </div>
      </section>
    </div>
  )
}
