// 号外NET 印西版（https://kamagaya-shiroi-inzai.goguynet.jp/）の記事から、コスモスパレットのイベント候補を取り出す。
//
// 背景（2026-09-16）: コスモスパレット公式サイトのイベント投稿は4件しかなく、マルシェ・夏祭り・ランタンフェス等は
// Instagram と地域メディア（号外NET）にしか出ない。Instagram はアプリ権限の都合で読めないため、号外NET の
// WordPress REST（posts?search=コスモスパレット）を毎朝読み、**題名・日時・会場・入場料・記事URL だけ**を
// 下書き候補にする（本文・写真は転記しない）。運営が管理画面で確認してから公開する。
//
// 記事の多くは末尾に定型ブロックを持つ:
//   ■日程：2026年9月13日（日）／■時間：14:00～19:30／■会場：コスモスパレットⅡ、花の丘公園Aゾーン／■入場料：無料
// 揺れ: 「■日時：2025年8月9日（土）15:00～20:00」「日程：」（■なし）「開催時間は15:00～20:00」（本文中）、ブロック無し。
// ブロックが無ければ題名の「9月13日（日）」から日付を取り、時間は仮置きにする。

import { createHash } from 'node:crypto'
import { blockText, inlineText, parseFeeText, parseTimeText, type BunkaCalendarEntry } from '@/lib/inzai-bunka/calendar'
import { parseDateText } from '@/lib/inzai-bunka/events'

export const GOGUYNET_ORIGIN = 'https://kamagaya-shiroi-inzai.goguynet.jp'
export const GOGUYNET_COSMOS_SOURCE = 'goguynet-cosmos'
export const COSMOS_SEARCH_WORD = 'コスモスパレット'

export function buildSearchUrl(): string {
  return `${GOGUYNET_ORIGIN}/wp-json/wp/v2/posts?search=${encodeURIComponent(COSMOS_SEARCH_WORD)}&per_page=50&_fields=id,date,modified,link,title,content`
}

export type GoguynetPost = {
  id: number
  date: string
  modified?: string
  link: string
  title: { rendered: string }
  content: { rendered: string }
}

/** inzai-bunka の登録処理をそのまま使えるよう、同じ形（BunkaCalendarEntry）に記事情報を足す */
export type CosmosCandidate = BunkaCalendarEntry & {
  postId: number
  /** 媒体名（号外NET 印西版／ちいき新聞）。説明文と主催表示に使う */
  mediaName: string
  articleUrl: string
  articleTitle: string
  articleDate: string
  /** 記事から拾った定型行（■日程：… など）。説明文に事実としてそのまま載せる */
  infoLines: string[]
}

const COSMOS_RE = /コスモスパレット|cosmos\s*palette/i
// 区切りは「：」「:」のほか、ちいき新聞の「日時／7月25日…」の「／」「/」も許す
const LABEL_RE = /^[■●◆◇□・▼▶]?\s*(開催日時|開催日|日程|日時|開催時間|時間|開催場所|会場|場所|入場料|参加費|料金)\s*[：:／/]\s*(.*)$/

/** 記事HTMLを行の配列にする（埋め込み Instagram の定型文などは除く） */
export function articleLines(html: string): string[] {
  return blockText(html)
    .split('\n')
    .filter((l) => l && !/^View this post on Instagram$/i.test(l) && !/^A post shared by/i.test(l))
}

export function cleanArticleTitle(raw: string): string {
  return inlineText(raw).replace(/【[^】]*】/g, '').trim()
}

/** コスモスパレットの催しの記事か（題名か会場に名前がある。本文で触れているだけの記事は除く） */
export function isCosmosArticle(title: string, lines: string[]): boolean {
  if (COSMOS_RE.test(title)) return true
  return lines.some((l) => {
    const m = LABEL_RE.exec(l)
    return !!m && /会場|場所/.test(m[1]) && COSMOS_RE.test(m[2])
  })
}

/** 記事題名からイベント名を作る。「…」があればその中、無ければ日付と「開催！」以降を落とす */
export function eventTitleFromArticle(title: string): string {
  const t = cleanArticleTitle(title)
  const q = /「([^」]+)」/.exec(t)
  let name = q ? q[1] : t
  if (!q) {
    name = name
      .replace(/^(?:\d{4}年)?\d{1,2}月\d{1,2}日(?:[（(][^）)]*[）)])?\s*[:：]?\s*/, '')
      .replace(/(開催|が開催されます|が始まりました|募集中です).*$/, '')
      .replace(/[！!。].*$/, '')
      .trim()
  }
  if (!name) name = t
  return name.length > 80 ? `${name.slice(0, 79)}…` : name
}

/** 「15時～20時」「14時30分」を「15:00～20:00」「14:30」にそろえる（parseTimeText は HH:MM しか読まない） */
export function normalizeJaTime(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 「午後3時」→「15時」「午前10時」→「10時」（ちいき新聞の書き方）。午後12時は12時のまま
    .replace(/午後\s*(\d{1,2})時/g, (_, h) => `${Number(h) < 12 ? Number(h) + 12 : Number(h)}時`)
    .replace(/午前\s*(\d{1,2})時/g, (_, h) => `${Number(h)}時`)
    .replace(/(\d{1,2})時(\d{1,2})分/g, (_, h, m) => `${h}:${String(m).padStart(2, '0')}`)
    .replace(/(\d{1,2})時半/g, (_, h) => `${h}:30`)
    .replace(/(\d{1,2})時(?![\d:])/g, (_, h) => `${h}:00`)
}

type Labeled = { date?: string; time?: string; venue?: string; fee?: string; lines: string[] }

function pickLabeled(lines: string[]): Labeled {
  const out: Labeled = { lines: [] }
  for (let i = 0; i < lines.length; i++) {
    const m = LABEL_RE.exec(lines[i])
    if (!m) continue
    const label = m[1]
    let value = m[2].trim()
    // 「■開催日時：」のように値が次の行以降にあるとき（予選①／予選②／決勝 など複数行）は、次のラベルまでをまとめる
    if (!value) {
      const cont: string[] = []
      for (let j = i + 1; j < lines.length && cont.length < 6 && !LABEL_RE.test(lines[j]); j++) cont.push(lines[j].trim())
      value = cont.join('\n')
    }
    if (!value) continue
    out.lines.push(`${label}：${value}`)
    if (/開催日時|開催日|日程|日時/.test(label)) {
      if (!out.date) out.date = value
      if (!out.time && /\d{1,2}[:：時]/.test(value)) out.time = value
    } else if (/時間/.test(label)) {
      if (!out.time) out.time = value
    } else if (/会場|場所/.test(label)) {
      if (!out.venue) out.venue = value
    } else if (/入場料|参加費|料金/.test(label)) {
      if (!out.fee) out.fee = value
    }
  }
  return out
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * 1記事から候補（開催日ごと）を作る。コスモスパレットの記事でなければ空配列。
 * 日付が読めない記事も空配列（skipped として呼び出し側が数える）。
 */
export type MediaSource = { name: string; idPrefix: string }
export const GOGUYNET_MEDIA: MediaSource = { name: '号外NET 印西版', idPrefix: 'goguynet' }

export function extractCandidates(post: GoguynetPost, media: MediaSource = GOGUYNET_MEDIA): CosmosCandidate[] {
  const articleTitle = cleanArticleTitle(post.title.rendered)
  const lines = articleLines(post.content.rendered)
  if (!isCosmosArticle(articleTitle, lines)) return []
  const articleDate = post.date.slice(0, 10)
  const year = Number(articleDate.slice(0, 4))
  const lab = pickLabeled(lines)

  // 日付: 定型行 → 題名。記事日より前になったら翌年扱い（12月の記事が「1月○日」を告知する場合）
  let parsed = lab.date ? parseDateText(lab.date, year) : { dates: [] as string[], isRange: false }
  if (parsed.dates.length === 0) parsed = parseDateText(articleTitle, year)
  let dates = parsed.dates.map((d) => (d < articleDate ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : d))
  if (parsed.isRange && dates.length === 2) {
    const [a, b] = dates
    const span = (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000
    if (span < 0 || span > 3) return [] // 長い期間（休館案内・募集期間）はイベントにしない
    dates = []
    for (let d = a; d <= b; d = addDays(d, 1)) dates.push(d)
  }
  dates = Array.from(new Set(dates))
  if (dates.length === 0) return []

  // 時間: 定型行 → 本文中の「開催時間は15:00～20:00」
  let timeText = lab.time ?? ''
  if (!timeText) {
    const prose = lines.find((l) => /時間/.test(l) && /\d{1,2}[:：時]\d{0,2}/.test(l))
    if (prose) timeText = prose
  }
  const t = parseTimeText(normalizeJaTime(timeText))
  const venue = lab.venue ?? 'コスモスパレット'
  const feeText = lab.fee ?? ''
  const title = eventTitleFromArticle(post.title.rendered)

  return dates.map((date) => ({
    postId: post.id,
    mediaName: media.name,
    articleUrl: post.link,
    articleTitle,
    articleDate,
    infoLines: lab.lines,
    date,
    title,
    detailUrl: post.link,
    isSyusai: false,
    timeText: timeText ? normalizeJaTime(timeText) : '',
    venue,
    feeText,
    organizer: '',
    contact: '',
    startAt: `${date}T${t.start}`,
    endAt: `${date}T${t.end}`,
    timeAssumed: t.assumed,
    fee: parseFeeText(feeText),
    sourceId: `${media.idPrefix}:${post.id}:${date}`,
    imageUrl: null,
  }))
}

/** 同じ日の同じ催しを複数の記事が告知しているとき（先行予約→開催直前）、新しい記事だけ残す */
export function dedupeCandidates(cands: CosmosCandidate[]): CosmosCandidate[] {
  const sorted = [...cands].sort((a, b) => (a.articleDate < b.articleDate ? 1 : a.articleDate > b.articleDate ? -1 : 0))
  const kept: CosmosCandidate[] = []
  for (const c of sorted) {
    if (kept.some((k) => k.date === c.date && isSameEvent(k.title, c.title))) continue
    kept.push(c)
  }
  return kept.sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
}

function isSameEvent(a: string, b: string): boolean {
  // 「Cosmos Palette 夏祭り 2026」（号外NET）と「コスモスパレット 夏祭り」（ちいき新聞）を同じ催しと見なす
  const n = (s: string) =>
    s.normalize('NFKC').toLowerCase().replace(/[\s・･\-–—~〜～「」『』（）()!！?？。、]/g, '').replace(/cosmospalette/g, 'コスモスパレット')
  const x = n(a)
  const y = n(b)
  return x === y || x.includes(y) || y.includes(x) || x.slice(0, 6) === y.slice(0, 6)
}

/** 変更検知用（題名・日時・会場・料金・定型行） */
export function candidateFingerprint(c: CosmosCandidate): string {
  return createHash('sha1').update([c.title, c.startAt, c.endAt, c.venue, c.feeText, ...c.infoLines].join('|')).digest('hex').slice(0, 16)
}

/** events.description（本文は転記せず、事実の定型行と記事URLだけ） */
export function toCandidateDescription(c: CosmosCandidate): string {
  const lines: string[] = [`地域メディア「${c.mediaName}」の記事から自動で拾った候補です。詳しくは記事をご覧ください。`]
  if (c.infoLines.length > 0) lines.push(c.infoLines.map((l) => `■${l}`).join('\n'))
  if (c.timeAssumed) lines.push('※時間は記事に明記が無いため仮置きです。')
  lines.push(`記事：${c.articleTitle}\n${c.articleUrl}`)
  return lines.join('\n\n')
}
