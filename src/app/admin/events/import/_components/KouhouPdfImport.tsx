'use client'

// 広報いんざい（PDF）の一括取り込み UI。
//
// チラシ取り込み（BulkFlyerImport）がカード型なのに対し、こちらは表形式にしている。
// 1号あたりのイベント候補が数十件あり（実測: 令和8年9月号は日時付き記事が77件）、
// カードを縦に並べると全体を見渡して取捨選択できないため。
//
// /api/events/scan-pdf は1回に10ページ分しか読まない（Vercel の60秒制限に収めるため）。
// ここでは総ページ数を見ながら 1-10 / 11-20 … とページ範囲をずらして呼び直す。
// どこまで読んだかはサーバーが返すため、AI の判断による読み飛ばしは起きない。

import { useState } from 'react'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { importScannedEvents, type ImportItem, type ImportResult } from '../actions'

type Row = ImportItem & {
  rowKey: string
  page: number
  checked: boolean
  confidence: number
  occurrenceLabel?: string
}

type ScannedEvent = {
  page?: number
  title?: string
  description?: string
  start_at?: string | null
  end_at?: string | null
  location?: string | null
  online_flag?: boolean
  organizer_name?: string | null
  capacity?: number | null
  fee?: number | null
  category?: string
  occurrences?: { start_at: string; end_at: string }[]
  confidence?: number
}

type ScanResponse = {
  ok?: boolean
  reason?: string
  doc_id?: string
  total_pages?: number
  from_page?: number
  to_page?: number
  events?: ScannedEvent[]
}

const REASON_MESSAGES: Record<string, string> = {
  quota: 'AI抽出が一時的に利用できません（クレジット残高をご確認ください）',
  config: 'AI抽出の設定に問題があります（APIキー・管理者権限をご確認ください）',
  busy: 'AIが混み合っています。時間をおいて再実行してください',
  too_large: 'PDFが大きすぎます（20MB以下のものを指定してください）',
  parse: 'PDFの読み取り結果を解釈できませんでした',
  fetch: 'PDFを取得できませんでした（URLをご確認ください）',
  blocked_url: '印西市公式サイト（city.inzai.lg.jp）のPDFのURLを指定してください',
  no_events: 'イベントが見つかりませんでした',
  unknown: 'PDFの読み取りに失敗しました',
}

// 1回の呼び出しで読むページ数。10ページだと出力が3,000トークン規模になり
// Vercel の60秒に収まらない恐れがあるため、6ページ（実測で1回あたり約2,000字の入力）に抑える。
const PAGES_PER_CALL = 6
// 呼び出し回数の上限。10ページ×8回＝80ページ分。広報いんざいは30ページ前後なので足りるが、
// 想定外に長いPDFを延々と読み続けないための歯止め（打ち切ったことは利用者に伝える）。
const MAX_PASSES = 8

const inp =
  'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs'

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

// 重複排除キー。同じ号を再度読み込んでも同じ値になる必要があるため、
// 抽出直後のタイトルで作って以降は固定する（利用者がタイトルを直しても変えない）。
function makeDedupeKey(docId: string, page: number, title: string, suffix: string): string {
  const slug = title.replace(/[\s　]/g, '').slice(0, 24)
  return `${docId}#p${page}-${slug}${suffix}`
}

const isValidCategory = (k: string | undefined): boolean =>
  !!k && PROPOSAL_CATEGORIES.some((c) => c.key === k)

export function KouhouPdfImport() {
  const [url, setUrl] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState('')
  const [notices, setNotices] = useState<string[]>([])
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function scan() {
    if (!url.trim()) return
    setScanning(true)
    setResults(null)
    setRows([])
    const newNotices: string[] = []
    const collected: Row[] = []
    let fromPage = 1
    let totalPages = 0

    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const toPage = fromPage + PAGES_PER_CALL - 1
        setProgress(
          totalPages > 0
            ? `${fromPage}〜${Math.min(toPage, totalPages)}ページを読み取り中…（全${totalPages}ページ）`
            : `${fromPage}〜${toPage}ページを読み取り中…`,
        )

        const res = await fetch('/api/events/scan-pdf', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), fromPage, toPage }),
        })
        const data = (await res.json().catch(() => ({}))) as ScanResponse

        if (!res.ok || data.ok === false) {
          const reason = data.reason ?? 'unknown'
          newNotices.push(REASON_MESSAGES[reason] ?? REASON_MESSAGES.unknown)
          break
        }

        const docId = data.doc_id ?? 'kouhou'
        totalPages = data.total_pages ?? totalPages
        const events = Array.isArray(data.events) ? data.events : []

        for (const ev of events) {
          const page = typeof ev.page === 'number' ? ev.page : fromPage
          const title = (ev.title ?? '').slice(0, 80)
          if (!title) continue

          const base = {
            source: 'kouhou' as const,
            page,
            description: ev.description ?? '',
            category: isValidCategory(ev.category) ? (ev.category as string) : 'other',
            location: ev.location ?? '',
            online_flag: Boolean(ev.online_flag),
            capacity: ev.capacity ?? null,
            fee: ev.fee ?? null,
            organizer_name: ev.organizer_name ?? '',
            source_url: url.trim(),
            confidence: ev.confidence ?? 0,
            checked: true,
            title,
          }

          const occ = Array.isArray(ev.occurrences) ? ev.occurrences : []
          // 複数日程は日程ごとの行に分ける（重複判定キーも回ごとに分けて増殖を防ぐ）
          if (occ.length > 1) {
            occ.forEach((o, idx) => {
              const s = normalizeDt(o.start_at)
              const key = makeDedupeKey(docId, page, title, `#${idx}`)
              collected.push({
                ...base,
                rowKey: key,
                dedupe_key: key,
                start_at: s,
                end_at: normalizeDt(o.end_at) || (s ? plusOneHour(s) : ''),
                occurrenceLabel: `${idx + 1}/${occ.length} 回目`,
              })
            })
          } else {
            const s = normalizeDt(ev.start_at)
            const key = makeDedupeKey(docId, page, title, '')
            collected.push({
              ...base,
              rowKey: key,
              dedupe_key: key,
              start_at: s,
              end_at: normalizeDt(ev.end_at) || (s ? plusOneHour(s) : ''),
            })
          }
        }

        setRows([...collected])

        // 何ページまで読んだかはサーバーが返す。AI の判断に頼らないので読み飛ばしが起きない。
        const readTo = data.to_page ?? toPage
        if (totalPages > 0 && readTo >= totalPages) break
        fromPage = readTo + 1

        if (pass === MAX_PASSES - 1) {
          newNotices.push(
            `読み取り回数の上限（${MAX_PASSES}回）に達したため${readTo}ページで打ち切りました。` +
              'このPDFは想定より長いようです。',
          )
        }
      }

      if (collected.length === 0 && newNotices.length === 0) {
        newNotices.push('参加できるイベントが見つかりませんでした。')
      }
    } catch {
      newNotices.push('読み取り中に通信エラーが発生しました')
    }

    setNotices(newNotices)
    setProgress('')
    setScanning(false)
  }

  function update(rowKey: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)))
  }

  function setAllChecked(checked: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, checked })))
  }

  async function submit() {
    const targets = rows.filter((r) => r.checked)
    if (targets.length === 0) return
    setSubmitting(true)
    try {
      const res = await importScannedEvents(
        targets.map((r) => ({
          dedupe_key: r.dedupe_key,
          source: r.source,
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
          source_url: r.source_url,
        })),
      )
      setResults(res)
      const okKeys = new Set(
        res.filter((x) => x.status === 'created' || x.status === 'duplicated').map((x) => x.dedupe_key),
      )
      setRows((prev) => prev.filter((r) => !okKeys.has(r.dedupe_key)))
    } catch (e) {
      setNotices([e instanceof Error ? e.message : '登録に失敗しました'])
    } finally {
      setSubmitting(false)
    }
  }

  const checkedCount = rows.filter((r) => r.checked).length
  const missingDate = rows.filter((r) => r.checked && (!r.start_at || !r.end_at)).length

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 space-y-2">
        <label className="block text-sm font-medium">広報いんざいのPDFのURL</label>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.city.inzai.lg.jp/cmsfiles/contents/.../kouhou_2609.pdf"
            disabled={scanning}
            className="flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning || !url.trim()}
            className="rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-sm font-bold disabled:opacity-40 whitespace-nowrap"
          >
            {scanning ? '読み取り中…' : '読み取る'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          印西市サイトの各号のページを開き、PDFのリンクを右クリック→リンクのアドレスをコピーして貼り付けます。
          給付金の案内やお知らせは取り込まず、市民が参加できる講座・催しだけをAIが選びます。
          読み取り結果はそのまま登録されず、下の一覧で確認・修正してから登録します。
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
            <p key={r.dedupe_key} className="text-xs text-rose-700 dark:text-rose-400">
              失敗（{r.dedupe_key}）: {r.message}
            </p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="text-sm">
                読み取り結果 {rows.length} 件（{checkedCount} 件を登録対象に選択中）
              </p>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => setAllChecked(true)} className="underline text-slate-500">
                  すべて選択
                </button>
                <button type="button" onClick={() => setAllChecked(false)} className="underline text-slate-500">
                  すべて解除
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || checkedCount === 0 || missingDate > 0}
              className="rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              {submitting ? '登録中…' : `${checkedCount} 件を登録する`}
            </button>
          </div>

          {missingDate > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              日時が読み取れていない行が {missingDate} 件あります。日時を入力するか、選択を外してください。
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 dark:bg-slate-800">
                <tr className="text-left">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 w-10">頁</th>
                  <th className="p-2 min-w-[200px]">イベント名</th>
                  <th className="p-2 min-w-[160px]">開始</th>
                  <th className="p-2 min-w-[160px]">終了</th>
                  <th className="p-2 min-w-[140px]">場所</th>
                  <th className="p-2 min-w-[140px]">主催</th>
                  <th className="p-2 min-w-[130px]">分野</th>
                  <th className="p-2 min-w-[240px]">説明</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.rowKey}
                    className={`border-t border-slate-200 dark:border-slate-700 ${
                      r.checked ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="p-2 align-top">
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={(e) => update(r.rowKey, { checked: e.target.checked })}
                      />
                    </td>
                    <td className="p-2 align-top text-slate-500 whitespace-nowrap">
                      P{r.page}
                      {r.occurrenceLabel && <div className="text-[10px]">{r.occurrenceLabel}</div>}
                      <div className="text-[10px]">{Math.round(r.confidence * 100)}%</div>
                    </td>
                    <td className="p-2 align-top">
                      <input
                        value={r.title}
                        onChange={(e) => update(r.rowKey, { title: e.target.value })}
                        className={inp}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        type="datetime-local"
                        value={r.start_at}
                        onChange={(e) => update(r.rowKey, { start_at: e.target.value })}
                        className={`${inp} ${r.start_at ? '' : 'border-amber-400'}`}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        type="datetime-local"
                        value={r.end_at}
                        onChange={(e) => update(r.rowKey, { end_at: e.target.value })}
                        className={`${inp} ${r.end_at ? '' : 'border-amber-400'}`}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        value={r.location ?? ''}
                        onChange={(e) => update(r.rowKey, { location: e.target.value })}
                        className={inp}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        value={r.organizer_name ?? ''}
                        onChange={(e) => update(r.rowKey, { organizer_name: e.target.value })}
                        placeholder="空欄なら主催者不明"
                        className={inp}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <select
                        value={r.category}
                        onChange={(e) => update(r.rowKey, { category: e.target.value })}
                        className={inp}
                      >
                        {PROPOSAL_CATEGORIES.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 align-top">
                      <textarea
                        rows={3}
                        value={r.description}
                        onChange={(e) => update(r.rowKey, { description: e.target.value })}
                        className={inp}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
