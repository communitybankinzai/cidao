// 印西市公式サイト（https://www.city.inzai.lg.jp/）の「イベント・お知らせ」月別カレンダーと各ページの解析。
//
// 背景（2026-09-16 中司さん決定・案C）: 広報いんざいの催し欄は市サイトのどこにも一覧が無いが、
// 月別カレンダー `/event2/YYYYMM.html` には市主催の催し（月10件前後）が載る。AI を使わずにここを毎朝読み、
// 候補（下書き）として運営が確認してから公開する。
//
// カレンダー: <table id="calendar_month"> の各行が1日。<th class="cal_date">D</th> … <td><ul><li><img alt="分類">
//   <a href="../0000020551.html">題名</a></li></ul></td>。複数日の催しは複数の行に同じリンクが出る。
// 詳細ページ: <div id="mol_contents"> が本文。「日時」「場所」「定員」「申し込み」が見出し（h2/h3）または
//   「◆日にち：」「◆会場：」のような行。日付は和暦（令和8年9月27日（日曜日）14時から16時）。
//   課ごとに書式が違うので、読めない項目は空にして候補に回す（運営が直して公開）。

import { blockText, inlineText, parseFeeText, parseTimeText, type BunkaCalendarEntry } from '@/lib/inzai-bunka/calendar'
import { normalizeJaTime } from '@/lib/goguynet/cosmos'

export const INZAI_CITY_ORIGIN = 'https://www.city.inzai.lg.jp'
export const INZAI_CITY_SOURCE = 'inzai-city-calendar'

export function buildCityCalendarUrl(year: number, month: number): string {
  return `${INZAI_CITY_ORIGIN}/event2/${year}${String(month).padStart(2, '0')}.html`
}

export type CityCalendarItem = {
  pageId: string
  url: string
  title: string
  /** カレンダー上の分類（スポーツ／講座・催し／募集 など） */
  kind: string
  /** カレンダーに載っている日付（昇順・重複なし） */
  dates: string[]
}

export type CityDetail = {
  title: string
  /** 掲載日 [2026年8月19日] */
  postedAt: string | null
  dateText: string
  timeText: string
  venue: string
  feeText: string
  capacityText: string
  applyText: string
  targetText: string
  department: string
}

export type CityCandidate = BunkaCalendarEntry & {
  pageId: string
  kind: string
  /** 連続する長い期間（イルミネーション等）を1件にまとめたときの最終日 */
  periodEnd: string | null
  infoLines: string[]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function absUrl(href: string): string {
  if (/^https?:\/\//.test(href)) return href
  return `${INZAI_CITY_ORIGIN}/${href.replace(/^(\.\.\/|\.\/|\/)+/, '')}`
}

/** 月別カレンダーの HTML を解析。リンク先（ページID）ごとに日付をまとめる */
export function parseCityCalendarHtml(html: string, year: number, month: number): CityCalendarItem[] {
  const table = /<table id="calendar_month">([\s\S]*?)<\/table>/.exec(html)
  if (!table) return []
  const byUrl = new Map<string, CityCalendarItem>()
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let row: RegExpExecArray | null
  while ((row = rowRe.exec(table[1])) !== null) {
    const th = /class="cal_date">(\d{1,2})</.exec(row[1])
    if (!th) continue
    const date = `${year}-${pad2(month)}-${pad2(Number(th[1]))}`
    const liRe = /<li>([\s\S]*?)<\/li>/g
    let li: RegExpExecArray | null
    while ((li = liRe.exec(row[1])) !== null) {
      const a = /<a href="([^"]+)">([\s\S]*?)<\/a>/.exec(li[1])
      if (!a) continue
      const url = absUrl(a[1])
      const pageId = /(\d{10})\.html/.exec(url)?.[1] ?? url.replace(/[^a-zA-Z0-9]/g, '').slice(-16)
      const kind = /<img alt="([^"]*)"/.exec(li[1])?.[1] ?? ''
      const item = byUrl.get(url) ?? { pageId, url, title: inlineText(a[2]), kind, dates: [] }
      if (!item.dates.includes(date)) item.dates.push(date)
      byUrl.set(url, item)
    }
  }
  return Array.from(byUrl.values()).map((i) => ({ ...i, dates: [...i.dates].sort() }))
}

/** 「令和8年9月27日」「2026年9月27日」→ YYYY-MM-DD（複数あれば全部） */
export function parseWarekiDates(text: string): string[] {
  const norm = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const out: string[] = []
  const re = /(?:令和\s*(\d{1,2})|(\d{4}))年\s*(\d{1,2})月\s*(\d{1,2})日/g
  let m: RegExpExecArray | null
  while ((m = re.exec(norm)) !== null) {
    const year = m[1] ? 2018 + Number(m[1]) : Number(m[2])
    const d = `${year}-${pad2(Number(m[3]))}-${pad2(Number(m[4]))}`
    if (!out.includes(d)) out.push(d)
  }
  return out
}

const LABELS: { key: keyof Omit<CityDetail, 'title' | 'postedAt' | 'department'>; re: RegExp }[] = [
  { key: 'dateText', re: /^(開催日時|開催日|日時|日程|日にち|開催期間)$/ },
  { key: 'timeText', re: /^(時間|開催時間)$/ },
  { key: 'venue', re: /^(会場|場所|開催場所|開催会場)$/ },
  { key: 'feeText', re: /^(費用|参加費|料金|受講料|入場料)$/ },
  { key: 'capacityText', re: /^(定員|募集人数)$/ },
  { key: 'applyText', re: /^(申し込み|申込み|申込|申し込み方法|申込方法|申込先|申し込み先)$/ },
  { key: 'targetText', re: /^(対象|対象者)$/ },
]

/** 詳細ページの本文（mol_contents）を行に分け、「見出し→次の行」「◆ラベル：値」の両方から項目を拾う */
export function parseCityDetailHtml(html: string): CityDetail {
  const title = inlineText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '')
  const posted = /class="syosai_hiduke">\[([^\]]+)\]/.exec(html)?.[1] ?? ''
  const postedAt = parseWarekiDates(posted)[0] ?? null
  const main = /<div id="mol_contents"[^>]*>([\s\S]*?)(?:<!--\s*▼+アンケート|class="kiji_aside"|<div class="design">)/.exec(html)?.[1] ?? ''
  // 見出しは行として残す（h2/h3 の前後に改行を入れてから blockText）
  const lines = blockText(main.replace(/<\/?h[2-4][^>]*>/g, '\n'))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const out: CityDetail = {
    title, postedAt, dateText: '', timeText: '', venue: '', feeText: '', capacityText: '', applyText: '', targetText: '', department: '',
  }
  const inlineRe = /^[◆■●◇□・▼]?\s*([^：:／/]{1,8})\s*[：:]\s*(.+)$/
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/[\s　]+/g, ' ').trim()
    // 「◆日にち：令和8年10月4日（日曜日）」型
    const inl = inlineRe.exec(l)
    if (inl) {
      const label = inl[1].replace(/[\s　]/g, '')
      const hit = LABELS.find((x) => x.re.test(label))
      if (hit) {
        if (!out[hit.key]) out[hit.key] = inl[2].trim()
        continue
      }
    }
    // 見出し型（行全体がラベル）→ 次のラベルまでの行を値にする（最大4行）
    const label = l.replace(/[\s　]/g, '')
    const hit = LABELS.find((x) => x.re.test(label))
    if (hit && !out[hit.key]) {
      const vals: string[] = []
      for (let j = i + 1; j < lines.length && vals.length < 4; j++) {
        const nl = lines[j].replace(/[\s　]/g, '')
        if (LABELS.some((x) => x.re.test(nl)) || /^(内容|注意事項|備考|その他|問い?合わせ|申込先)/.test(nl)) break
        vals.push(lines[j].trim())
      }
      out[hit.key] = vals.join('\n')
    }
  }
  // 「◆時　間：」のように日時欄が無く時間だけの場合、日時欄に時刻があればそれを時間にも使う
  if (!out.timeText && /\d{1,2}(時|:)/.test(out.dateText)) out.timeText = out.dateText
  // 担当課（お問い合わせ欄の「印西市役所○○課」）
  const dept = /お問い合わせ[\s\S]{0,200}?印西市役所([^<\n]{2,60}?)\s*(?:<|電話|\n)/.exec(html.replace(/<[^>]+>/g, '\n'))
  out.department = dept ? dept[1].replace(/[\s　]+/g, ' ').trim() : ''
  return out
}

/** 複数日程の日時欄から、その日に当たる行だけを抜く（無ければ全文） */
function timeTextFor(text: string, date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const lines = text.split('\n')
  const hit = lines.filter((l) => {
    const ds = parseWarekiDates(l)
    if (ds.includes(date)) return true
    return new RegExp(`(^|[^\\d])${m}月\\s*${d}日`).test(l.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))) && !/\d{4}年|令和/.test(l)
  })
  void y
  return hit.length > 0 ? hit.join('\n') : text
}

const LONG_PERIOD_DAYS = 5

/**
 * カレンダーの1項目＋詳細から候補を作る。
 * - 日付はカレンダーの日付を正とする（詳細の和暦は時間の抽出にだけ使う）
 * - 連続 LONG_PERIOD_DAYS 日を超える催し（イルミネーション等）は初日の1件にまとめ periodEnd を持つ
 */
export function cityItemToCandidates(item: CityCalendarItem, detail: CityDetail | null): CityCandidate[] {
  if (item.dates.length === 0) return []
  let dates = item.dates
  let periodEnd: string | null = null
  if (dates.length > LONG_PERIOD_DAYS) {
    const first = new Date(`${dates[0]}T00:00:00Z`).getTime()
    const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime()
    const span = Math.round((last - first) / 86_400_000) + 1
    if (span === dates.length) {
      periodEnd = dates[dates.length - 1]
      dates = [dates[0]]
    }
  }
  const baseTitle = item.title.replace(/[（(【]\s*(令和|20\d\d|\d{1,2}月)[^）)】]*(開催|実施)?[）)】]/g, '').replace(/\s+/g, ' ').trim() || item.title
  const infoLines: string[] = []
  if (detail?.dateText) infoLines.push(`日時：${detail.dateText.replace(/\n/g, ' ')}`)
  if (detail?.timeText && detail.timeText !== detail.dateText) infoLines.push(`時間：${detail.timeText.replace(/\n/g, ' ')}`)
  if (detail?.venue) infoLines.push(`場所：${detail.venue.replace(/\n/g, ' ')}`)
  if (detail?.targetText) infoLines.push(`対象：${detail.targetText.replace(/\n/g, ' ')}`)
  if (detail?.capacityText) infoLines.push(`定員：${detail.capacityText.replace(/\n/g, ' ')}`)
  if (detail?.feeText) infoLines.push(`費用：${detail.feeText.replace(/\n/g, ' ')}`)
  if (detail?.applyText) infoLines.push(`申し込み：${detail.applyText.replace(/\n/g, ' ')}`)

  return dates.map((date) => {
    const tt = detail ? timeTextFor(detail.timeText || detail.dateText, date) : ''
    const t = parseTimeText(normalizeJaTime(tt))
    const venue = detail?.venue.split('\n')[0] ?? ''
    const title = periodEnd ? `${baseTitle}（〜${Number(periodEnd.slice(5, 7))}/${Number(periodEnd.slice(8, 10))}）` : baseTitle
    return {
      pageId: item.pageId,
      kind: item.kind,
      periodEnd,
      infoLines,
      date,
      title: title.length > 80 ? `${title.slice(0, 79)}…` : title,
      detailUrl: item.url,
      isSyusai: true,
      timeText: tt ? normalizeJaTime(tt) : '',
      venue,
      feeText: detail?.feeText ?? '',
      organizer: detail?.department ? `印西市 ${detail.department}` : '印西市',
      contact: '',
      startAt: `${date}T${t.start}`,
      endAt: `${date}T${t.end}`,
      timeAssumed: t.assumed,
      fee: parseFeeText(detail?.feeText ?? ''),
      sourceId: `city:${item.pageId}:${date}`,
      imageUrl: null,
    }
  })
}

/** 分類アイコン → CiDAO のカテゴリ */
export function cityKindToCategory(kind: string): string {
  if (/スポーツ/.test(kind)) return 'bunka'
  if (/子育て|こども|子ども/.test(kind)) return 'kodomo'
  if (/健康|福祉/.test(kind)) return 'fukushi'
  if (/防災|防犯/.test(kind)) return 'bosai'
  if (/環境/.test(kind)) return 'kankyo'
  return 'other'
}

export function toCityDescription(c: CityCandidate): string {
  const lines: string[] = ['印西市公式サイトの「イベント・お知らせ」から自動で拾った候補です。詳しくは市のページをご覧ください。']
  if (c.infoLines.length > 0) lines.push(c.infoLines.map((l) => `■${l}`).join('\n'))
  if (c.periodEnd) lines.push(`※${c.periodEnd.replace(/-/g, '/')} まで続く催しのため、初日の1件にまとめています。`)
  if (c.timeAssumed) lines.push('※時間は市のページから読み取れなかったため仮置きです。')
  lines.push(`出典：印西市ホームページ\n${c.detailUrl}`)
  return lines.join('\n\n')
}
