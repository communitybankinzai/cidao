// Instagram 取り込みの朝の結果報告メール（運営決定 2026-10-01：結果の一覧・経費の見積もり・一時停止ボタン）。
// #印西（ハッシュタグ）の結果に、モニタ対象アカウント（団体・企業・行政）の結果を合わせて 1 通にする。
// 本文の組み立てだけを行う純粋関数（送信は route.ts）。event_sync_runs の行からも組み立てられる（?report=1 で再送）。

import type { AccountReport, IgPrefilterCounts } from './sync'

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
  /** アカウント経由の実行だけ */
  accounts: AccountReport[] | null
}

export type AccountSection = { result: ReportResult; startedAt: Date; finishedAt: Date }

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
  monitorUrl: string
  pauseUrl: string
  /** モニタ対象アカウントの実行（同じ朝の分）。無ければ null */
  accounts?: AccountSection | null
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
    accounts: Array.isArray(d.accounts) ? (d.accounts as AccountReport[]) : null,
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

const h3 = (t: string) => `<h3 style="font-size:15px;margin:14px 0 4px">${esc(t)}</h3>`

function table(xs: [string, string][]): string {
  return (
    '<table style="border-collapse:collapse;font-size:14px">' +
    xs.map(([k, v]) => `<tr><th style="text-align:left;padding:4px 10px 4px 0;color:#444;font-weight:600;white-space:nowrap;vertical-align:top">${esc(k)}</th><td style="padding:4px 0">${v}</td></tr>`).join('') +
    '</table>'
  )
}

function prefilterNote(pf: IgPrefilterCounts | null): string {
  return pf ? `日付なし ${pf.noDate}・画像なし ${pf.noImage}・催しの語なし ${pf.noEventWord}・対象外 ${pf.notEvent}・読み取り済み ${pf.already}` : ''
}

/** アカウント別の表（候補の数は inserted のラベル末尾「@username」で数える） */
function accountRows(section: AccountSection): { label: string; username: string; kind: string; posts: number; fresh: number; candidates: number; error: string | null }[] {
  const per = section.result.accounts ?? []
  return per.map((a) => ({
    label: a.label || a.username, username: a.username, kind: a.kind, posts: a.posts, fresh: a.fresh,
    candidates: section.result.inserted.filter((s) => s.endsWith(` @${a.username}`)).length,
    error: a.error,
  }))
}

export function buildReportMail(input: ReportInput): { subject: string; html: string; text: string } {
  const { result: r, startedAt, finishedAt } = input
  const acc = input.accounts ?? null
  const ar = acc?.result ?? null
  const date = fmtDate.format(startedAt)
  const time = fmtTime.format(startedAt)
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
  const accSeconds = acc ? Math.max(0, Math.round((acc.finishedAt.getTime() - acc.startedAt.getTime()) / 1000)) : 0
  const totalInserted = r.inserted.length + (ar?.inserted.length ?? 0)
  const totalCost = r.costJpy + (ar?.costJpy ?? 0)
  const totalScanned = r.fetched.details + (ar?.fetched.details ?? 0)
  const anyError = !r.ok || (ar ? !ar.ok : false)
  const limit = r.budget?.limitJpy ?? ar?.budget?.limitJpy ?? 0
  const exhausted = !!(r.budget?.exhausted || ar?.budget?.exhausted)
  const remaining = Math.max(0, limit - input.monthCostJpy)
  const projected = projectMonthEnd(input.monthCostJpy, startedAt)
  const warn = anyError ? '⚠ ' : exhausted ? '⏸ ' : ''
  const breakdown = acc ? `（#${input.hashtag} ${r.inserted.length}・アカウント ${ar!.inserted.length}）` : ''
  const subject = `${warn}【CiDAO】Instagram 取り込み ${date} の結果：候補 ${totalInserted} 件${breakdown}・費用 ${yen(totalCost)}`

  const hashtagRows: [string, string][] = [
    ['実行', `${date} ${time}（${seconds} 秒）${r.dryRun ? '・確認のみ（登録なし）' : ''}`],
    [`取得した投稿（直近24時間の #${input.hashtag}）`, `${r.fetched.list} 件`],
    ['一次ふるい通過（AI 不使用）', `${r.fetched.calendar} 件${prefilterNote(r.prefilter) ? `（${prefilterNote(r.prefilter)}）` : ''}`],
    ['AI に読ませた画像', `${r.fetched.details} 枚（失敗 ${r.fetched.detailFailed}）`],
    ['読み取れた日程', `${r.fetched.merged} 件（今日以降 ${r.fetched.future} 件）`],
    ['候補として登録（下書き）', `${r.inserted.length} 件`],
    ['重複のため登録せず', `${r.duplicates.length} 件`],
    ['見送り・未読み取り', `${r.skipped.length} 件`],
    ['エラー', `${r.errors.length} 件`],
  ]
  const accountSummaryRows: [string, string][] | null = ar
    ? [
        ['実行', `${fmtTime.format(acc!.startedAt)}（${accSeconds} 秒）${ar.dryRun ? '・確認のみ（登録なし）' : ''}`],
        ['モニタ対象', `${(ar.accounts ?? []).length} アカウント（取得できず ${(ar.accounts ?? []).filter((a) => a.error).length}）`],
        ['読んだ投稿', `${ar.fetched.list} 件（新しく未読み取り ${(ar.accounts ?? []).reduce((s, a) => s + a.fresh, 0)} 件）`],
        ['一次ふるい通過（AI 不使用）', `${ar.fetched.calendar} 件${prefilterNote(ar.prefilter) ? `（${prefilterNote(ar.prefilter)}）` : ''}`],
        ['AI に読ませた画像', `${ar.fetched.details} 枚（失敗 ${ar.fetched.detailFailed}）`],
        ['候補として登録（下書き）', `${ar.inserted.length} 件`],
        ['重複のため登録せず', `${ar.duplicates.length} 件`],
        ['見送り・未読み取り', `${ar.skipped.length} 件`],
        ['エラー', `${ar.errors.length} 件`],
      ]
    : null
  const costRows: [string, string][] = [
    ['今回の読み取り費用', `${yen(totalCost)}（${totalScanned} 枚・${esc(input.model)}）`],
    ['今月の累計', `${yen(input.monthCostJpy)} ／ 上限 ${yen(limit, 0)}（残り ${yen(remaining)}）`],
    ['月末時点の見込み', `約 ${yen(projected, 0)}（今月の 1 日あたり平均 × 日数）`],
    ['記録開始からの累計', yen(input.totalCostJpy)],
  ]
  if (exhausted) costRows.push(['状態', '今月の上限に達したため、翌月 1 日まで読み取りを止めています'])

  const accountTableHtml = acc
    ? '<table style="border-collapse:collapse;font-size:13px;width:100%">' +
      '<tr style="background:#f1f5f9"><th style="text-align:left;padding:4px 6px">アカウント</th><th style="padding:4px 6px">種別</th><th style="padding:4px 6px">投稿</th><th style="padding:4px 6px">新規</th><th style="padding:4px 6px">候補</th><th style="text-align:left;padding:4px 6px">状態</th></tr>' +
      accountRows(acc)
        .map(
          (a) =>
            `<tr><td style="padding:4px 6px;border-top:1px solid #eee">${esc(a.label)}<br><a href="https://www.instagram.com/${esc(a.username)}/" style="color:#1d4ed8;font-size:12px">@${esc(a.username)}</a></td>` +
            `<td style="padding:4px 6px;border-top:1px solid #eee;text-align:center">${esc(a.kind)}</td>` +
            `<td style="padding:4px 6px;border-top:1px solid #eee;text-align:center">${a.posts}</td>` +
            `<td style="padding:4px 6px;border-top:1px solid #eee;text-align:center">${a.fresh}</td>` +
            `<td style="padding:4px 6px;border-top:1px solid #eee;text-align:center;font-weight:600">${a.candidates}</td>` +
            `<td style="padding:4px 6px;border-top:1px solid #eee;color:${a.error ? '#b00' : '#047857'}">${esc(a.error ?? 'OK')}</td></tr>`,
        )
        .join('') +
      '</table>'
    : ''

  const html = [
    `<div style="font-family:-apple-system,'Segoe UI','Hiragino Sans','Noto Sans JP',sans-serif;color:#222;max-width:720px">`,
    `<h2 style="font-size:18px;margin:0 0 6px">Instagram 取り込み ${esc(date)} の結果</h2>`,
    `<p style="margin:0 0 12px">候補 <b>${totalInserted} 件</b>${esc(breakdown)}・読み取り ${totalScanned} 枚・費用 <b>${yen(totalCost)}</b>${anyError ? '・<b style="color:#b00">エラーあり</b>' : ''}</p>`,
    h3(`#${input.hashtag}（ハッシュタグ）`),
    table(hashtagRows.map(([k, v]) => [k, esc(v)])),
    h3('登録した候補（下書き）'),
    listHtml(r.inserted, 30),
    h3('重複のため登録しなかったもの'),
    listHtml(r.duplicates),
    h3('見送り・未読み取りの理由'),
    listHtml(r.skipped),
    r.errors.length > 0 ? `<h3 style="font-size:15px;margin:14px 0 4px;color:#b00">エラー</h3>${listHtml(r.errors)}` : '',
    `<hr style="border:0;border-top:1px solid #ddd;margin:18px 0">`,
    h3('モニタ対象アカウント（団体・企業・行政）'),
    ar
      ? [
          table(accountSummaryRows!.map(([k, v]) => [k, esc(v)])),
          `<div style="margin:8px 0">${accountTableHtml}</div>`,
          ar.errors.length > 0 ? `<p style="margin:6px 0;color:#b00;font-weight:600">${listHtml(ar.errors)}</p>` : '',
          `<p style="margin:4px 0 8px;font-weight:600;font-size:14px">登録した候補（下書き）</p>`,
          listHtml(ar.inserted, 40),
          `<p style="margin:4px 0 8px;font-weight:600;font-size:14px">重複・見送りの理由</p>`,
          listHtml([...ar.duplicates, ...ar.skipped], 12),
        ].join('')
      : `<p style="margin:4px 0;color:#666">今朝のアカウント巡回の記録がありません（対象が未登録、または実行前）。</p>`,
    `<p style="margin:6px 0 0;font-size:12px"><a href="${esc(input.monitorUrl)}">モニタ対象の一覧・追加 →</a>（団体は「団体編集」の SNS 欄に Instagram の URL を入れると自動で対象になります）</p>`,
    (totalInserted > 0)
      ? `<p style="margin:10px 0 0"><a href="${esc(input.adminUrl)}" style="font-weight:600">管理画面で候補を確認して「公開」か「見送り」を押す →</a></p>`
      : '',
    `<hr style="border:0;border-top:1px solid #ddd;margin:18px 0">`,
    h3("経費の見積もり（Anthropic API・CBI と N's factory で共有のクレジットから）"),
    table(costRows),
    `<p style="margin:4px 0 0;font-size:12px;color:#666">Instagram の取得（Graph API）と Vercel の実行は無料枠内で、別途の費用はかかりません。金額は料金表からの推定です。</p>`,
    `<div style="margin:22px 0 10px;padding:14px;border:1px solid #ddd;border-radius:8px;background:#fafafa">`,
    `<a href="${esc(input.pauseUrl)}" style="display:inline-block;padding:10px 18px;background:#b45309;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">⏸ 自動取り込みを一時停止する</a>`,
    `<p style="margin:8px 0 0;font-size:12px;color:#555">押すと確認ページが開きます。「停止する」を押した翌朝から取り込み（ハッシュタグ・アカウントの両方）を行いません（費用も発生しません）。再開は同じページ、または管理画面「イベント一括取り込み」のボタンからできます。</p>`,
    `</div>`,
    `<p style="font-size:12px;color:#666;margin:10px 0 0">このメールは毎朝の自動取り込みのあとに自動送信しています。<a href="${esc(input.adminUrl)}">管理画面「イベント一括取り込み」</a></p>`,
    `</div>`,
  ].join('')

  const text = [
    `Instagram 取り込み ${date} の結果`,
    `候補 ${totalInserted} 件${breakdown}・読み取り ${totalScanned} 枚・費用 ${yen(totalCost)}${anyError ? '・エラーあり' : ''}`,
    '',
    `■ #${input.hashtag}（ハッシュタグ）`,
    ...hashtagRows.map(([k, v]) => `${k}：${v}`),
    '',
    '■ 登録した候補（下書き）',
    listText(r.inserted, 30),
    '',
    '■ 重複のため登録しなかったもの',
    listText(r.duplicates),
    '',
    '■ 見送り・未読み取りの理由',
    listText(r.skipped),
    r.errors.length > 0 ? `\n■ エラー\n${listText(r.errors)}` : '',
    '',
    '■ モニタ対象アカウント（団体・企業・行政）',
    ...(ar
      ? [
          ...accountSummaryRows!.map(([k, v]) => `${k}：${v}`),
          ...accountRows(acc!).map((a) => `  - ${a.label}（@${a.username}・${a.kind}）投稿 ${a.posts}・新規 ${a.fresh}・候補 ${a.candidates}・${a.error ?? 'OK'}`),
          ar.errors.length > 0 ? `エラー：\n${listText(ar.errors)}` : '',
          '登録した候補（下書き）：',
          listText(ar.inserted, 40),
          '重複・見送り：',
          listText([...ar.duplicates, ...ar.skipped], 12),
        ]
      : ['  今朝のアカウント巡回の記録がありません']),
    `モニタ対象の一覧・追加：${input.monitorUrl}`,
    totalInserted > 0 ? `管理画面で確認：${input.adminUrl}` : '',
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
