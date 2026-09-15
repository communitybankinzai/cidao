// 印西市文化ホールの「公演・イベント情報」一覧（/event/）と各詳細ページ（/event/<postId>/）の解析。
//
// 月別カレンダー（calendar.ts）は「ホール」で行う催しだけを載せ、多目的室・大会議室の主催公演
// （手仕事工房・ファミリーコンサート等）は一覧ページにしか出ない（2026-09-15 実測）。
// そのため主催公演はこちらを正とし、カレンダーは貸館公演（他団体の発表会等）の補完に使う。
//
// 一覧の構造:
//   <ul class="event_list_archive"><li class="clearfix genre_N">
//     <p class="date">2026年10月6日(火), 11月10日(火), ...</p>   ← 複数日は「, 」区切り、期間は「〜」
//     <h3><a href=".../event/<postId>/">題名</a></h3>
//     <p class="catch_copy">…</p>
//     <table><tr><th>時間</th><td>…</td></tr></table>
//     <div class="thumb"><img src="/src/…"></div>
// 詳細の構造:
//   「公演概要」タブの <table class="table_2"> に 日程／時間／料金／会場／対象／定員／申込 の th/td、
//   2つ目の table に 主催／後援／企画協力。お問い合わせは <section class="eventRelation"> 内。

import { createHash } from 'node:crypto'
import {
  INZAI_BUNKA_ORIGIN,
  blockText,
  decodeEntities,
  inlineText,
  parseFeeText,
  parseTimeText,
  type BunkaCalendarEntry,
} from './calendar'

export const INZAI_BUNKA_EVENT_LIST_URL = `${INZAI_BUNKA_ORIGIN}/event/`

export type BunkaListItem = {
  postId: string
  url: string
  title: string
  catchCopy: string
  dateText: string
  /** 開催日 YYYY-MM-DD の配列（期間表記なら始点と終点の2件） */
  dates: string[]
  /** 「10月1日 〜 3月31日」のような期間表記（募集案内など）。イベントとしては登録しない */
  isRange: boolean
  timeText: string
  isSyusai: boolean
  imageUrl: string | null
}

export type BunkaDetail = {
  venue: string
  feeText: string
  organizer: string
  contact: string
  capacityText: string
  targetText: string
  applyText: string
  imageUrl: string | null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function absUrl(src: string): string {
  if (/^https?:\/\//.test(src)) return src
  return `${INZAI_BUNKA_ORIGIN}${src.startsWith('/') ? '' : '/'}${src}`
}

/**
 * 「2026年10月6日(火), 11月10日(火), 12月10日(木)」「2026年10月1日(木) 〜 2027年3月31日(水)」を日付配列に。
 * 年の無い要素は直前の年を引き継ぎ、月が前の要素より小さくなったら翌年とみなす。
 */
export function parseDateText(text: string): { dates: string[]; isRange: boolean } {
  const norm = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const isRange = /[〜～~]/.test(norm)
  const re = /(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日/g
  const dates: string[] = []
  let year: number | null = null
  let prevMonth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(norm)) !== null) {
    const month = Number(m[2])
    const day = Number(m[3])
    if (m[1]) {
      year = Number(m[1])
    } else if (year !== null && month < prevMonth) {
      year += 1
    }
    if (year === null || month < 1 || month > 12 || day < 1 || day > 31) continue
    dates.push(`${year}-${pad2(month)}-${pad2(day)}`)
    prevMonth = month
  }
  return { dates: Array.from(new Set(dates)), isRange }
}

/** 一覧ページの HTML を解析する。構造が違えば空配列 */
export function parseEventListHtml(html: string): BunkaListItem[] {
  const ul = /<ul class="event_list_archive">([\s\S]*?)<\/ul>/.exec(html)
  if (!ul) return []
  const items: BunkaListItem[] = []
  const blocks = ul[1].split(/<li class="clearfix genre_\d+">/).slice(1)
  for (const b of blocks) {
    const h3 = /<h3>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/.exec(b)
    if (!h3) continue
    const url = decodeEntities(h3[1])
    const postId = /\/event\/(\d+)\/?/.exec(url)?.[1]
    if (!postId) continue
    const dateRaw = /<p class="date">([\s\S]*?)<\/p>/.exec(b)
    const dateText = dateRaw ? inlineText(dateRaw[1]) : ''
    const { dates, isRange } = parseDateText(dateText)
    const catchRaw = /<p class="catch_copy">([\s\S]*?)<\/p>/.exec(b)
    const timeRaw = /<th>\s*時間\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(b)
    const img = /<div class="thumb">[\s\S]*?<img[^>]+src="([^"]+)"/.exec(b)
    items.push({
      postId,
      url,
      title: inlineText(h3[2]),
      catchCopy: catchRaw ? blockText(catchRaw[1]) : '',
      dateText,
      dates,
      isRange,
      timeText: timeRaw ? blockText(timeRaw[1]) : '',
      isSyusai: /tag-syusai/.test(b),
      imageUrl: img ? absUrl(decodeEntities(img[1])) : null,
    })
  }
  return items
}

function thTd(html: string, label: string): string {
  const re = new RegExp(`<th>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`)
  const m = re.exec(html)
  return m ? blockText(m[1]) : ''
}

/** 詳細ページの HTML から公演概要を取り出す。無い項目は空文字 */
export function parseEventDetailHtml(html: string): BunkaDetail {
  // 「公演概要」タブ以降だけを見る（チケット情報タブにも「料金」があるため先頭のものを使えばよい）
  const contact = /<section class="relation clearfix eventRelation">[\s\S]*?<div class="relation_detail[^"]*">([\s\S]*?)<\/div>/.exec(html)
  const img = /<img[^>]+src="([^"]*\/src\/[^"]+)"/.exec(html)
  return {
    venue: thTd(html, '会場'),
    feeText: thTd(html, '料金'),
    organizer: thTd(html, '主催'),
    contact: contact ? blockText(contact[1]) : '',
    capacityText: thTd(html, '定員'),
    targetText: thTd(html, '対象'),
    applyText: thTd(html, '申し?込み?'),
    imageUrl: img ? absUrl(decodeEntities(img[1])) : null,
  }
}

/** 複数日程の時間欄から、その日（M/D）に該当する行だけを抜く。該当行が無ければ全文 */
export function timeTextForDate(timeText: string, date: string): string {
  const [, mm, dd] = date.split('-')
  const md = `${Number(mm)}/${Number(dd)}`
  const lines = timeText.split('\n')
  const hit = lines.filter((l) => new RegExp(`(^|[^\\d])${md.replace('/', '\\/')}(\\(|[^\\d])`).test(l))
  return hit.length > 0 ? hit.join('\n') : timeText
}

/**
 * 一覧アイテム＋詳細を、開催日ごとの BunkaCalendarEntry に展開する。
 * 期間表記（募集案内）は空配列。詳細が取れなかった場合は detail を null で渡す。
 */
export function listItemToEntries(item: BunkaListItem, detail: BunkaDetail | null): BunkaCalendarEntry[] {
  if (item.isRange || item.dates.length === 0) return []
  return item.dates.map((date) => {
    const timeText = item.dates.length > 1 ? timeTextForDate(item.timeText, date) : item.timeText
    const t = parseTimeText(timeText)
    const feeText = detail?.feeText ?? ''
    return {
      date,
      title: item.title,
      detailUrl: item.url,
      isSyusai: item.isSyusai,
      timeText,
      venue: detail?.venue ?? '',
      feeText,
      organizer: detail?.organizer ?? '',
      contact: detail?.contact ?? '',
      startAt: `${date}T${t.start}`,
      endAt: `${date}T${t.end}`,
      timeAssumed: t.assumed,
      fee: parseFeeText(feeText),
      sourceId: `post:${item.postId}:${date}`,
      imageUrl: detail?.imageUrl ?? item.imageUrl,
      extra: {
        catchCopy: item.catchCopy || undefined,
        capacityText: detail?.capacityText || undefined,
        targetText: detail?.targetText || undefined,
        applyText: detail?.applyText || undefined,
      },
    }
  })
}

/**
 * 一覧由来（詳細つき）とカレンダー由来を sourceId で突き合わせ、一覧由来を優先して1本にする。
 * カレンダーにしか無いもの（貸館公演＝ cal:… ）はそのまま残る。
 */
export function mergeEntries(fromList: BunkaCalendarEntry[], fromCalendar: BunkaCalendarEntry[]): BunkaCalendarEntry[] {
  const seen = new Set<string>()
  const out: BunkaCalendarEntry[] = []
  for (const e of [...fromList, ...fromCalendar]) {
    if (seen.has(e.sourceId)) continue
    seen.add(e.sourceId)
    out.push(e)
  }
  return out.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0))
}

/** 変更検知用のハッシュ（題名・日時・会場・料金・主催が変わったら更新対象にする） */
export function entryFingerprint(e: BunkaCalendarEntry): string {
  return createHash('sha1')
    .update([e.title, e.startAt, e.endAt, e.venue, e.feeText, e.organizer, e.timeText].join('|'))
    .digest('hex')
    .slice(0, 16)
}
