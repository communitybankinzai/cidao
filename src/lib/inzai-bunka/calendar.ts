// 印西市文化ホール（https://www.inzai-bunka.jp/）の月別イベントカレンダーを解析する純粋関数群。
//
// 対象ページ: /event_calendar/?year_select=YYYY&month_select=M
//   <table class="event_list_table"> の各行が1日分。<th>DD日(曜)</th> の隣の <td> に
//   <div class="detail"> が公演の数だけ並ぶ（同日2件あり）。各 detail は
//     <h3>題名</h3>（主催公演は <a href=".../event/<postId>/"> 付き＋ tag-syusai ラベル）
//     <dl class="detail_info"> に 時間／会場／入場料等／主催／お問い合わせ の dt/dd
//   という固定構造（2026-09-15 時点の実サイトで確認）。
//
// 貸館公演（他団体の発表会等）は詳細ページを持たないので、カレンダー欄の情報だけが出典になる。
// AI は使わない。構造が変わったら parseCalendarHtml が 0 件を返すので、呼び出し側で検知すること。

import { createHash } from 'node:crypto'

export const INZAI_BUNKA_ORIGIN = 'https://www.inzai-bunka.jp'
export const INZAI_BUNKA_SOURCE = 'inzai-bunka-calendar'

export type BunkaCalendarEntry = {
  /** 開催日 YYYY-MM-DD */
  date: string
  title: string
  /** 主催公演の詳細ページ URL。貸館公演は null */
  detailUrl: string | null
  /** 「主催公演」ラベルが付いているか */
  isSyusai: boolean
  timeText: string
  venue: string
  feeText: string
  organizer: string
  contact: string
  /** JST 壁掛け時刻 YYYY-MM-DDTHH:MM（DB 保存前に jstLocalToUtcIso を通すこと） */
  startAt: string
  endAt: string
  /** 時間欄に時刻が無く 09:00〜17:00 を仮置きしたとき true */
  timeAssumed: boolean
  /** 入場料等から読み取った金額（無料=0、読めなければ null） */
  fee: number | null
  /** events.external_source_id に入れる一意キー（同じ公演の同じ日は再取得しても同じ値） */
  sourceId: string
  /** 一覧のサムネイル／詳細ページのチラシ画像（絶対URL）。カレンダー由来は null */
  imageUrl?: string | null
  /** 詳細ページにしか無い補足（定員・対象・申込・キャッチコピー） */
  extra?: { catchCopy?: string; capacityText?: string; targetText?: string; applyText?: string }
}

export function buildCalendarUrl(year: number, month: number): string {
  return `${INZAI_BUNKA_ORIGIN}/event_calendar/?year_select=${year}&month_select=${month}`
}

/** 基準日から count か月分の (year, month) を返す（基準月を含む） */
export function upcomingMonths(from: Date, count: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = []
  // JST の年月で数える（Vercel は UTC なので getMonth をそのまま使わない）
  const jst = new Date(from.getTime() + 9 * 60 * 60 * 1000)
  let y = jst.getUTCFullYear()
  let m = jst.getUTCMonth() + 1
  for (let i = 0; i < count; i++) {
    out.push({ year: y, month: m })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

/** タグを除去して1行のテキストにする（題名用） */
export function inlineText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[\s　]+/g, ' ')
    .trim()
}

/** タグを除去し、<p>/<br> を改行として残す（説明文用） */
export function blockText(html: string): string {
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(t)
    .split('\n')
    .map((l) => l.replace(/[\s　]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

type TimeParse = { start: string; end: string; assumed: boolean }

/**
 * 時間欄のテキストから開始・終了時刻（HH:MM）を決める。
 *   開始: 「開演」→「開始」→「開場」→「受付」の順に最初に付いている時刻。無ければ最初の時刻。
 *   終了: 「終了」に付いている時刻。無ければ「本文中の最も遅い時刻」と「開始+2時間」の遅い方（23:59 上限）。
 *   時刻が1つも無ければ 09:00〜17:00 を仮置きし assumed=true。
 */
export function parseTimeText(text: string): TimeParse {
  const norm = text.replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  // 時刻の直前の語（「開演」「受付開始」など）を label として持つ。
  // 「受付開始 12:45」を「開始」と誤認しないよう、長い語から順に末尾一致で判定する。
  const LABELS = ['受付開始', '開演', '開始', '開場', '受付', '終了'] as const
  const times: { hm: string; min: number; label: string }[] = []
  const re = /(\d{1,2}):(\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(norm)) !== null) {
    const h = Number(m[1])
    const mi = Number(m[2])
    if (h > 23 || mi > 59) continue
    const pre = norm.slice(Math.max(0, m.index - 8), m.index).replace(/[\s　]+$/, '')
    const label = LABELS.find((l) => pre.endsWith(l)) ?? ''
    times.push({ hm: `${pad2(h)}:${pad2(mi)}`, min: h * 60 + mi, label })
  }
  if (times.length === 0) return { start: '09:00', end: '17:00', assumed: true }

  const pick = (kw: string) => times.find((t) => t.label === kw)
  const startT = pick('開演') ?? pick('開始') ?? pick('開場') ?? pick('受付開始') ?? pick('受付') ?? times[0]
  const endKw = pick('終了')
  let endMin: number
  if (endKw && endKw.min > startT.min) {
    endMin = endKw.min
  } else {
    const latest = Math.max(...times.map((t) => t.min))
    endMin = Math.max(latest, startT.min + 120)
  }
  if (endMin <= startT.min) endMin = startT.min + 120
  if (endMin > 23 * 60 + 59) endMin = 23 * 60 + 59
  return { start: startT.hm, end: `${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`, assumed: false }
}

/** 入場料等のテキストから代表金額を読む。「無料」だけなら 0、最初の「N円」があればその数値、どちらも無ければ null */
export function parseFeeText(text: string): number | null {
  const norm = text.replace(/[０-９，]/g, (c) => (c === '，' ? ',' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
  const yen = /(\d{1,3}(?:,\d{3})+|\d+)\s*円/.exec(norm)
  if (yen) return Number(yen[1].replace(/,/g, ''))
  if (/無料/.test(norm)) return 0
  return null
}

function extractDl(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<dt>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const key = inlineText(m[1]).replace(/[：:]\s*$/, '')
    out[key] = blockText(m[2])
  }
  return out
}

/**
 * 月別カレンダーの HTML を解析して公演一覧を返す。
 * 構造が想定と違えば空配列（例外は投げない）。
 */
export function parseCalendarHtml(html: string, year: number, month: number): BunkaCalendarEntry[] {
  const table = /<table class="event_list_table">([\s\S]*?)<\/table>/.exec(html)
  if (!table) return []
  const entries: BunkaCalendarEntry[] = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let row: RegExpExecArray | null
  while ((row = rowRe.exec(table[1])) !== null) {
    const th = /<th[^>]*>\s*(\d{1,2})日/.exec(row[1])
    if (!th) continue
    const day = Number(th[1])
    const date = `${year}-${pad2(month)}-${pad2(day)}`
    const details = row[1].split('<div class="detail">').slice(1)
    for (const d of details) {
      const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(d)
      if (!h3) continue
      const title = inlineText(h3[1])
      if (!title) continue
      const a = /<a\s+href="([^"]+)"/.exec(h3[1])
      const detailUrl = a ? decodeEntities(a[1]) : null
      const isSyusai = /tag-syusai/.test(d)
      const dl = extractDl(d)
      const timeText = dl['時間'] ?? ''
      const t = parseTimeText(timeText)
      const feeText = dl['入場料等'] ?? ''
      const organizer = dl['主催'] ?? ''
      const postId = detailUrl ? /\/event\/(\d+)\/?/.exec(detailUrl)?.[1] ?? null : null
      const sourceId = postId
        ? `post:${postId}:${date}`
        : `cal:${date}:${createHash('sha1').update(`${title}|${organizer}`).digest('hex').slice(0, 12)}`
      entries.push({
        date,
        title,
        detailUrl,
        isSyusai,
        timeText,
        venue: dl['会場'] ?? '',
        feeText,
        organizer,
        contact: dl['お問い合わせ'] ?? '',
        startAt: `${date}T${t.start}`,
        endAt: `${date}T${t.end}`,
        timeAssumed: t.assumed,
        fee: parseFeeText(feeText),
        sourceId,
      })
    }
  }
  return entries
}

/** CiDAO の events.description に入れる本文（出典を必ず末尾に付ける） */
export function toEventDescription(e: BunkaCalendarEntry, calendarUrl: string): string {
  const lines: string[] = []
  if (e.extra?.catchCopy) lines.push(e.extra.catchCopy)
  if (e.timeText) lines.push(`【時間】\n${e.timeText}`)
  if (e.venue) lines.push(`【会場】印西市文化ホール ${e.venue}`)
  if (e.feeText) lines.push(`【入場料等】\n${e.feeText}`)
  if (e.extra?.targetText) lines.push(`【対象】${e.extra.targetText}`)
  if (e.extra?.capacityText) lines.push(`【定員】${e.extra.capacityText}`)
  if (e.extra?.applyText) lines.push(`【申込】\n${e.extra.applyText}`)
  if (e.organizer) lines.push(`【主催】${e.organizer}`)
  if (e.contact) lines.push(`【お問い合わせ】\n${e.contact}`)
  if (e.timeAssumed) lines.push('※時間はカレンダーに記載が無いため仮置きです。主催者へご確認ください。')
  lines.push(`出典：印西市文化ホール イベントカレンダー\n${e.detailUrl ?? calendarUrl}`)
  return lines.join('\n\n')
}
