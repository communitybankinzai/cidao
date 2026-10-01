// Instagram #印西 取り込みの朝の結果報告メール（運営決定 2026-10-01：結果の一覧・経費の見積もり・一時停止ボタン）。
// 本文の組み立てだけを行う純粋関数（送信は route.ts）。event_sync_runs の 1 行からも組み立てられる（?report=1 で再送）。

import type { IgPrefilterCounts } from './sync'

export type ReportResult = {
  ok: boolean
  dryRun: boolean
  fetched: { list: number; details: number; detailFailed: number; calendar: number; merged: number; future: number }
  prefilter: IgPrefilterCounts | null
  inserted: string[]
  duplicates: string[]
  skipped: string[]
  errors: string[]
  unchanged: number
  costJpy: number
  budget: { monthBeforeJpy: number; limitJpy: number; exhausted: boolean } | null
  scanned: string[]
}

export type ReportInput = {
  result: ReportResult
  startedAt: Date
  finishedAt: Date
  model: string
  hashtag: string
  /** 今月の読み取り費用の累計（今回を含む・円） */
  monthCostJpy: number
  /** 記録を始めてからの累計（円） */
  totalCostJpy: number
  adminUrl: string
  pauseUrl: string
}

const fmtDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' })
const fmtTime = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function yen(n: number, digits = 1): string {
  return `${Number(n.toFixed(digits)).toLocaleString('ja-JP')} 円`
}

/** JST の「今日が月の何日目か」と「その月の日数」 */
export function monthProgressJst(d: Date): { day: number; days: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const [y, m, day] = parts.split('-').map(Number)
  return { day, days: new Date(Date.UTC(y, m, 0)).getUTCDate() }
}

/** 今月の累計から月末時点の見込みを出す（1 日あたりの平均 × 日数） */
export function projectMonthEnd(monthCostJpy: number, at: Date): number {
  const { day, days } = monthProgressJst(at)
  return day > 0 ? (monthCostJpy / day) * days : monthCostJpy
}

/** event_sync_runs の 1 行から ReportResult を復元する（?report=1 の再送用） */
export function resultFromRunRow(row: {
  ok: boolean
  dry_run: boolean
  fetched: Partial<ReportResult['fetched']> | null
  errors: string[] | null
  unchanged: number | null
  detail: Record<string, unknown> | null
}): ReportResult {
  const d = row.detail ?? {}
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
  const f = row.fetched ?? {}
  return {
    ok: row.ok,
    dryRun: row.dry_run,
    fetched: {
      list: f.list ?? 0, details: f.details ?? 0, detailFailed: f.detailFailed ?? 0,
      calendar: f.calendar ?? 0, merged: f.merged ?? 0, future: f.future ?? 0,
    },
    prefilter: (d.prefilter as IgPrefilterCounts | undefined) ?? null,
    inserted: arr(d.inserted),
    duplicates: arr(d.duplicates),
    skipped: arr(d.skipped),
    errors: row.errors ?? [],
    unchanged: row.unchanged ?? 0,
    costJpy: typeof d.costJpy === 'number' ? d.costJpy : 0,
    budget: (d.budget as ReportResult['budget']) ?? null,
    scanned: arr(d.scanned),
  }
}

function listHtml(items: string[], max = 10): string {
  if (items.length === 0) return '<p style="margin:4px 0;color:#666">なし</p>'
  const shown = items.slice(0, max).map((s) => `<li>${esc(s)}</li>`).join('')
  const more = items.length > max ? `<li style="color:#666">ほか ${items.length - max} 件</li>` : ''
  return `<ul style="margin:4px 0 8px 18px;padding:0">${shown}${more}</ul>`
}

function listText(items: string[], max = 10): string {
  if (items.length === 0) return '  なし'
  const lines = items.slice(0, max).map((s) => `  - ${s}`)
  if (items.length > max) lines.push(`  ほか ${items.length - max} 件`)
  return lines.join('\n')
}

export function buildReportMail(input: ReportInput): { subject: string; html: string; text: string } {
  const { result: r, startedAt, finishedAt } = input
  const date = fmtDate.format(startedAt)
  const time = fmtTime.format(startedAt)
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
  const limit = r.budget?.limitJpy ?? 0
  const remaining = Math.max(0, limit - input.monthCostJpy)
  const projected = projectMonthEnd(input.monthCostJpy, startedAt)
  const pf = r.prefilter
  const prefilterNote = pf
    ? `日付なし ${pf.noDate}・画像なし ${pf.noImage}・催しの語なし ${pf.noEventWord}・対象外 ${pf.notEvent}・読み取り済み ${pf.already}`
    : ''
  const warn = !r.ok ? '⚠ ' : r.budget?.exhausted ? '⏸ ' : ''
  const subject = `${warn}【CiDAO】Instagram #${input.hashtag} 取り込み ${date} の結果：候補 ${r.inserted.length} 件・費用 ${yen(r.costJpy)}`

  const rows: [string, string][] = [
    ['実行', `${date} ${time}（${seconds} 秒）${r.dryRun ? '・確認のみ（登録なし）' : ''}`],
    ['取得した投稿（直近24時間の #' + input.hashtag + '）', `${r.fetched.list} 件`],
    ['一次ふるい通過（AI 不使用）', `${r.fetched.calendar} 件${prefilterNote ? `（${prefilterNote}）` : ''}`],
    ['AI に読ませた画像', `${r.fetched.details} 枚（失敗 ${r.fetched.detailFailed}）`],
    ['読み取れた日程', `${r.fetched.merged} 件（今日以降 ${r.fetched.future} 件）`],
    ['候補として登録（下書き）', `${r.inserted.length} 件`],
    ['重複のため登録せず', `${r.duplicates.length} 件`],
    ['見送り・未読み取り', `${r.skipped.length} 件`],
    ['エラー', `${r.errors.length} 件`],
  ]
  const costRows: [string, string][] = [
    ['今回の読み取り費用', `${yen(r.costJpy)}（${r.fetched.details} 枚・${esc(input.model)}）`],
    ['今月の累計', `${yen(input.monthCostJpy)} ／ 上限 ${yen(limit, 0)}（残り ${yen(remaining)}）`],
    ['月末時点の見込み', `約 ${yen(projected, 0)}（今月の 1 日あたり平均 × 日数）`],
    ['記録開始からの累計', yen(input.totalCostJpy)],
  ]
  if (r.budget?.exhausted) costRows.push(['状態', '今月の上限に達したため、翌月 1 日まで読み取りを止めています'])

  const table = (xs: [string, string][]) =>
    '<table style="border-collapse:collapse;font-size:14px">' +
    xs.map(([k, v]) => `<tr><th style="text-align:left;padding:4px 10px 4px 0;color:#444;font-weight:600;white-space:nowrap;vertical-align:top">${esc(k)}</th><td style="padding:4px 0">${v}</td></tr>`).join('') +
    '</table>'

  const html = [
    `<div style="font-family:-apple-system,'Segoe UI','Hiragino Sans','Noto Sans JP',sans-serif;color:#222;max-width:680px">`,
    `<h2 style="font-size:18px;margin:0 0 6px">Instagram #${esc(input.hashtag)} 取り込み ${esc(date)} の結果</h2>`,
    `<p style="margin:0 0 12px">候補 <b>${r.inserted.length} 件</b>・読み取り ${r.fetched.details} 枚・費用 <b>${yen(r.costJpy)}</b>${!r.ok ? '・<b style="color:#b00">エラーあり</b>' : ''}</p>`,
    `<h3 style="font-size:15px;margin:14px 0 4px">一覧</h3>`,
    table(rows.map(([k, v]) => [k, esc(v)])),
    `<h3 style="font-size:15px;margin:14px 0 4px">登録した候補（下書き）</h3>`,
    listHtml(r.inserted, 30),
    r.inserted.length > 0
      ? `<p style="margin:4px 0 8px"><a href="${esc(input.adminUrl)}">管理画面で確認して「公開」か「見送り」を押す →</a></p>`
      : '',
    `<h3 style="font-size:15px;margin:14px 0 4px">重複のため登録しなかったもの</h3>`,
    listHtml(r.duplicates),
    `<h3 style="font-size:15px;margin:14px 0 4px">見送り・未読み取りの理由</h3>`,
    listHtml(r.skipped),
    r.errors.length > 0 ? `<h3 style="font-size:15px;margin:14px 0 4px;color:#b00">エラー</h3>${listHtml(r.errors)}` : '',
    `<h3 style="font-size:15px;margin:14px 0 4px">経費の見積もり（Anthropic API・CBI と N's factory で共有のクレジットから）</h3>`,
    table(costRows),
    `<p style="margin:4px 0 0;font-size:12px;color:#666">Instagram の取得（Graph API）と Vercel の実行は無料枠内で、別途の費用はかかりません。金額は料金表からの推定です。</p>`,
    `<div style="margin:22px 0 10px;padding:14px;border:1px solid #ddd;border-radius:8px;background:#fafafa">`,
    `<a href="${esc(input.pauseUrl)}" style="display:inline-block;padding:10px 18px;background:#b45309;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">⏸ 自動取り込みを一時停止する</a>`,
    `<p style="margin:8px 0 0;font-size:12px;color:#555">押すと確認ページが開きます。「停止する」を押した翌朝から取り込みを行いません（費用も発生しません）。再開は同じページ、または管理画面「イベント一括取り込み」のボタンからできます。</p>`,
    `</div>`,
    `<p style="font-size:12px;color:#666;margin:10px 0 0">このメールは毎朝の自動取り込みのあとに自動送信しています。<a href="${esc(input.adminUrl)}">管理画面「イベント一括取り込み」</a></p>`,
    `</div>`,
  ].join('')

  const text = [
    `Instagram #${input.hashtag} 取り込み ${date} の結果`,
    `候補 ${r.inserted.length} 件・読み取り ${r.fetched.details} 枚・費用 ${yen(r.costJpy)}${!r.ok ? '・エラーあり' : ''}`,
    '',
    '■ 一覧',
    ...rows.map(([k, v]) => `${k}：${v}`),
    '',
    '■ 登録した候補（下書き）',
    listText(r.inserted, 30),
    r.inserted.length > 0 ? `管理画面で確認：${input.adminUrl}` : '',
    '',
    '■ 重複のため登録しなかったもの',
    listText(r.duplicates),
    '',
    '■ 見送り・未読み取りの理由',
    listText(r.skipped),
    r.errors.length > 0 ? `\n■ エラー\n${listText(r.errors)}` : '',
    '',
    '■ 経費の見積もり（Anthropic API）',
    ...costRows.map(([k, v]) => `${k}：${v.replace(/<[^>]+>/g, '')}`),
    'Instagram の取得と Vercel の実行は無料枠内。金額は料金表からの推定。',
    '',
    `■ 自動取り込みを一時停止する（確認ページが開きます）：${input.pauseUrl}`,
    `管理画面：${input.adminUrl}`,
  ].join('\n')

  return { subject, html, text }
}
