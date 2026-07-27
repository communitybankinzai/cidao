'use client'

// チラシ画像を複数まとめて選び、既存の /api/events/scan（Claude）で抽出 → 内容を確認・修正 → 一括登録する。
// COCoLa の Drive フォルダ監視（5分間隔・Gemini Vision）を CBI 側で置き換えるための画面。
//
// AI 抽出は入力補助として扱い、登録前に必ず人が確認する（誤取得をそのまま公開しない）。

import { useState } from 'react'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { importScannedEvents, type ImportItem, type ImportResult } from '../actions'

type Row = ImportItem & {
  rowKey: string
  fileName: string
  checked: boolean
  confidence: number
  occurrenceLabel?: string
}

type Scanned = {
  ok?: boolean
  reason?: string
  title?: string
  description?: string
  start_at?: string | null
  end_at?: string | null
  location?: string | null
  online_flag?: boolean
  organizer_name?: string | null
  capacity?: number | null
  fee?: number | null
  occurrences?: { start_at: string; end_at: string }[]
  confidence?: number
  flyer_image_url?: string | null
}

const REASON_MESSAGES: Record<string, string> = {
  quota: 'AI抽出が一時的に利用できません（クレジット残高をご確認ください）',
  config: 'AI抽出の設定に問題があります（APIキーをご確認ください）',
  busy: 'AIが混み合っています。時間をおいて再実行してください',
  too_large: '画像サイズが大きすぎます（5MB以下に縮小してください）',
  parse: 'チラシの読み取りに失敗しました',
  unknown: 'チラシの読み取りに失敗しました',
}

const inp =
  'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm'

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// "YYYY-MM-DDTHH:MM" に整える。取れなければ空文字（＝登録前に手入力を促す）
function normalizeDt(s: string | null | undefined): string {
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : ''
}

function plusOneHour(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s)
  if (!m) return s
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 1, Number(m[5]))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function BulkFlyerImport() {
  const [rows, setRows] = useState<Row[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState('')
  const [notices, setNotices] = useState<string[]>([])
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleFiles(files: FileList) {
    setScanning(true)
    setResults(null)
    const newNotices: string[] = []
    const list = Array.from(files)

    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      setProgress(`${i + 1} / ${list.length} 枚目を読み取り中…（${file.name}）`)
      try {
        const sha = await sha256Hex(file)
        const fd = new FormData()
        fd.append('image', file)
        const res = await fetch('/api/events/scan', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => ({}))) as Scanned

        if (!res.ok || data.ok === false) {
          const reason = data.reason ?? 'unknown'
          newNotices.push(`${file.name}：${REASON_MESSAGES[reason] ?? REASON_MESSAGES.unknown}`)
          continue
        }

        const occ = Array.isArray(data.occurrences) ? data.occurrences : []
        const base = {
          fileName: file.name,
          title: (data.title ?? '').replace('（読み取り失敗）', '').slice(0, 80),
          description: data.description ?? '',
          category: 'other',
          location: data.location ?? '',
          online_flag: Boolean(data.online_flag),
          capacity: data.capacity ?? null,
          fee: data.fee ?? null,
          organizer_name: data.organizer_name ?? '',
          flyer_image_url: data.flyer_image_url ?? null,
          confidence: data.confidence ?? 0,
          checked: true,
        }

        // 同一チラシに複数日程がある場合は日程ごとの行に展開する（GAS の occurrences 分割と同じ挙動）。
        // 重複判定キーも日程ごとに分ける（再アップロードで増殖しない）。
        if (occ.length > 1) {
          occ.forEach((o, idx) => {
            const s = normalizeDt(o.start_at)
            setRows((prev) => [
              ...prev,
              {
                ...base,
                rowKey: `${sha}#${idx}`,
                image_sha256: `${sha}#${idx}`,
                start_at: s,
                end_at: normalizeDt(o.end_at) || (s ? plusOneHour(s) : ''),
                occurrenceLabel: `${idx + 1}/${occ.length} 回目`,
              },
            ])
          })
        } else {
          const s = normalizeDt(data.start_at)
          setRows((prev) => [
            ...prev,
            {
              ...base,
              rowKey: sha,
              image_sha256: sha,
              start_at: s,
              end_at: normalizeDt(data.end_at) || (s ? plusOneHour(s) : ''),
            },
          ])
        }
      } catch {
        newNotices.push(`${file.name}：読み取り中に通信エラーが発生しました`)
      }
    }

    setNotices(newNotices)
    setProgress('')
    setScanning(false)
  }

  function update(rowKey: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)))
  }

  async function submit() {
    const targets = rows.filter((r) => r.checked)
    if (targets.length === 0) return
    setSubmitting(true)
    try {
      const res = await importScannedEvents(
        targets.map((r) => ({
          image_sha256: r.image_sha256,
          title: r.title,
          description: r.description,
          category: r.category,
          start_at: r.start_at,
          end_at: r.end_at,
          location: r.location,
          online_flag: r.online_flag,
          capacity: r.capacity,
          fee: r.fee,
          organizer_name: r.organizer_name,
          flyer_image_url: r.flyer_image_url,
        })),
      )
      setResults(res)
      const okKeys = new Set(
        res.filter((x) => x.status === 'created' || x.status === 'duplicated').map((x) => x.image_sha256),
      )
      setRows((prev) => prev.filter((r) => !okKeys.has(r.image_sha256)))
    } catch (e) {
      setNotices([e instanceof Error ? e.message : '登録に失敗しました'])
    } finally {
      setSubmitting(false)
    }
  }

  const checkedCount = rows.filter((r) => r.checked).length

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 space-y-2">
        <label className="block text-sm font-medium">チラシ画像を選ぶ（複数選択できます）</label>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={scanning}
          onChange={(e) => {
            const f = e.target.files
            if (f && f.length > 0) void handleFiles(f)
            e.target.value = ''
          }}
          className="text-xs"
        />
        <p className="text-[11px] text-slate-500">
          1枚ずつAIが日時・場所・主催者を読み取ります。読み取り結果はそのまま登録されず、下の一覧で確認・修正してから登録します。
        </p>
        {scanning && <p className="text-xs text-slate-600 dark:text-slate-300">{progress}</p>}
      </div>

      {notices.length > 0 && (
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-3 space-y-1">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">お知らせ</p>
          {notices.map((n, i) => (
            <p key={i} className="text-xs text-slate-600 dark:text-slate-300">{n}</p>
          ))}
        </div>
      )}

      {results && (
        <div className="rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-3 space-y-1">
          <p className="text-xs font-medium">登録結果</p>
          <p className="text-xs">
            新規 {results.filter((r) => r.status === 'created').length} 件 ／ 重複スキップ{' '}
            {results.filter((r) => r.status === 'duplicated').length} 件 ／ 失敗{' '}
            {results.filter((r) => r.status === 'failed').length} 件
          </p>
          {results.filter((r) => r.status === 'failed').map((r) => (
            <p key={r.image_sha256} className="text-xs text-rose-700 dark:text-rose-400">
              失敗: {r.message}
            </p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm">
              読み取り結果 {rows.length} 件（{checkedCount} 件を登録対象に選択中）
            </p>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || checkedCount === 0}
              className="rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              {submitting ? '登録中…' : `${checkedCount} 件を登録する`}
            </button>
          </div>

          <div className="space-y-4">
            {rows.map((r) => (
              <div
                key={r.rowKey}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={r.checked}
                    onChange={(e) => update(r.rowKey, { checked: e.target.checked })}
                    className="mt-1"
                  />
                  {r.flyer_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.flyer_image_url}
                      alt=""
                      className="w-20 h-24 object-contain rounded border border-slate-200 dark:border-slate-700 bg-white"
                    />
                  )}
                  <div className="flex-1 space-y-1">
                    <p className="text-[11px] text-slate-500">
                      {r.fileName}
                      {r.occurrenceLabel ? ` ／ ${r.occurrenceLabel}` : ''}
                      {' ／ 自信度 '}
                      {Math.round(r.confidence * 100)}%
                    </p>
                    <input
                      value={r.title}
                      onChange={(e) => update(r.rowKey, { title: e.target.value })}
                      placeholder="イベント名"
                      className={inp}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="text-xs space-y-1">
                    <span className="text-slate-500">開始日時</span>
                    <input
                      type="datetime-local"
                      value={r.start_at}
                      onChange={(e) => update(r.rowKey, { start_at: e.target.value })}
                      className={inp}
                    />
                  </label>
                  <label className="text-xs space-y-1">
                    <span className="text-slate-500">終了日時</span>
                    <input
                      type="datetime-local"
                      value={r.end_at}
                      onChange={(e) => update(r.rowKey, { end_at: e.target.value })}
                      className={inp}
                    />
                  </label>
                  <label className="text-xs space-y-1">
                    <span className="text-slate-500">場所</span>
                    <input
                      value={r.location ?? ''}
                      onChange={(e) => update(r.rowKey, { location: e.target.value })}
                      className={inp}
                    />
                  </label>
                  <label className="text-xs space-y-1">
                    <span className="text-slate-500">主催団体名</span>
                    <input
                      value={r.organizer_name ?? ''}
                      onChange={(e) => update(r.rowKey, { organizer_name: e.target.value })}
                      placeholder="不明なら空欄（主催者不明として登録）"
                      className={inp}
                    />
                  </label>
                  <label className="text-xs space-y-1">
                    <span className="text-slate-500">分野</span>
                    <select
                      value={r.category}
                      onChange={(e) => update(r.rowKey, { category: e.target.value })}
                      className={inp}
                    >
                      {PROPOSAL_CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs pt-5">
                    <input
                      type="checkbox"
                      checked={r.online_flag}
                      onChange={(e) => update(r.rowKey, { online_flag: e.target.checked })}
                    />
                    オンライン開催
                  </label>
                </div>

                <label className="text-xs space-y-1 block">
                  <span className="text-slate-500">説明</span>
                  <textarea
                    rows={2}
                    value={r.description}
                    onChange={(e) => update(r.rowKey, { description: e.target.value })}
                    className={inp}
                  />
                </label>

                {(!r.start_at || !r.end_at) && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    日時が読み取れませんでした。登録するには入力してください。
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
