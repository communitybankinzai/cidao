// 印西市文化ホールの公演を CiDAO の events に同期する本体。
//
// 流れ: 公演一覧 → 各詳細ページ → 月別カレンダー（当月から数か月）→ 突き合わせ → 今日以降だけを
//       external_source='inzai-bunka-calendar' として insert／変更があれば update（運営決定 2026-09-15:
//       主催＋貸館の全部・即公開・文化ホール側の変更は自動で上書き）。
//
// テストしやすいよう fetch と DB は引数で差し替えられる（route.ts が本物を渡す）。

import { jstLocalToUtcIso } from '@/lib/datetime'
import {
  INZAI_BUNKA_SOURCE,
  buildCalendarUrl,
  parseCalendarHtml,
  toEventDescription,
  upcomingMonths,
  type BunkaCalendarEntry,
} from './calendar'
import {
  INZAI_BUNKA_EVENT_LIST_URL,
  listItemToEntries,
  mergeEntries,
  parseEventDetailHtml,
  parseEventListHtml,
} from './events'

export const CALENDAR_MONTHS = 6
const DETAIL_CONCURRENCY = 4
const FETCH_TIMEOUT_MS = 15_000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TITLE_MAX = 80 // events.title の CHECK 制約

export type ExistingEventRow = {
  id: string
  external_source_id: string
  title: string
  description: string
  start_at: string
  end_at: string
  location: string | null
  fee: number | null
  capacity: number | null
  organizer_name_text: string | null
  proxy_source_url: string | null
  flyer_image_url: string | null
}

export type EventRow = {
  title: string
  description: string
  category: string
  start_at: string
  end_at: string
  location: string
  online_flag: boolean
  capacity: number | null
  fee: number | null
  organizer_type: 'member'
  organizer_id: string
  organizer_name_text: string
  proxy_registration: true
  proxy_source_url: string
  external_source: string
  external_source_id: string
  flyer_image_url: string | null
  /** 文化ホール同期は即公開（open）。号外NET の候補は運営確認待ち（draft） */
  status: 'open' | 'draft'
}

export type OtherEventRow = {
  id: string
  title: string
  start_at: string
  location: string | null
  organizer_name_text: string | null
}

/** route.ts が本物の Supabase で実装し、テストは偽物を渡す最小インターフェース */
export type SyncDb = {
  listExisting(): Promise<ExistingEventRow[]>
  /** 文化ホール同期以外で登録済みの、fromDate（JST の日付）以降のイベント。手動登録との重複判定に使う */
  listOtherFutureEvents(fromDate: string): Promise<OtherEventRow[]>
  insert(row: EventRow): Promise<void>
  update(id: string, patch: Partial<EventRow>): Promise<void>
  /** 画像を event-flyers バケットへ置き、公開URLを返す。失敗は null */
  uploadFlyer(path: string, bytes: Uint8Array, contentType: string): Promise<string | null>
}

export type SyncOptions = {
  botMemberId: string
  /** true なら DB に書かず、何をするかだけ返す */
  dryRun?: boolean
  now?: Date
  fetchFn?: typeof fetch
  log?: (msg: string) => void
}

export type SyncResult = {
  ok: boolean
  fetched: { list: number; details: number; detailFailed: number; calendar: number; merged: number; future: number }
  inserted: string[]
  updated: string[]
  unchanged: number
  skipped: string[]
  /** 同じ日に文化ホールで似た題名の手動登録があるため insert しなかったもの */
  duplicates: string[]
  errors: string[]
  dryRun: boolean
}

/** 題名の比較用に、空白・記号・全角半角の違いを消す */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[!?！？。、,.:：;／/\-‐－–—~〜～「」『』（）()［］\[\]【】・…'"“”’]/g, '')
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/**
 * 手動登録と同じ公演かどうか。片方がもう片方を含む／先頭8文字一致／2文字組の Dice 係数 0.5 以上 のどれか。
 * （手動登録は「フライデーナイトコンサート Vol.15 『星の王子さま』…」のように副題まで入っていることが多い）
 */
export function isSimilarTitle(a: string, b: string): boolean {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  if (x.length >= 8 && y.length >= 8 && x.slice(0, 8) === y.slice(0, 8)) return true
  const bx = bigrams(x)
  const by = bigrams(y)
  if (bx.size === 0 || by.size === 0) return false
  let common = 0
  for (const g of bx) if (by.has(g)) common++
  return (2 * common) / (bx.size + by.size) >= 0.5
}

/** 同じ日（JST）に placeRe に合う会場で似た題名の既存イベントがあれば返す */
export function findDuplicateEvent(e: BunkaCalendarEntry, others: OtherEventRow[], placeRe: RegExp): OtherEventRow | null {
  for (const o of others) {
    if (todayJst(new Date(o.start_at)) !== e.date) continue
    const place = `${o.location ?? ''} ${o.organizer_name_text ?? ''}`
    if (!placeRe.test(place)) continue
    if (isSimilarTitle(e.title, o.title)) return o
  }
  return null
}

/** 同じ日（JST）に文化ホールで似た題名の既存イベントがあれば返す */
export function findManualDuplicate(e: BunkaCalendarEntry, others: OtherEventRow[]): OtherEventRow | null {
  return findDuplicateEvent(e, others, /文化ホール/)
}

async function fetchText(fetchFn: typeof fetch, url: string): Promise<string> {
  const res = await fetchFn(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; CiDAO-event-sync/1.0; +https://cidao.vercel.app)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return await res.text()
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export function parseCapacity(text: string | undefined): number | null {
  if (!text) return null
  const norm = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const m = /(\d{1,5})\s*(?:名|人|組)/.exec(norm)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

export function todayJst(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now)
}

export function entryToRow(e: BunkaCalendarEntry, botMemberId: string, flyerImageUrl: string | null): EventRow {
  const calendarUrl = buildCalendarUrl(Number(e.date.slice(0, 4)), Number(e.date.slice(5, 7)))
  const title = e.title.length > TITLE_MAX ? `${e.title.slice(0, TITLE_MAX - 1)}…` : e.title
  return {
    title,
    description: toEventDescription(e, calendarUrl),
    category: 'bunka',
    start_at: jstLocalToUtcIso(e.startAt),
    end_at: jstLocalToUtcIso(e.endAt),
    location: e.venue ? `印西市文化ホール ${e.venue}` : '印西市文化ホール',
    online_flag: false,
    capacity: parseCapacity(e.extra?.capacityText),
    fee: e.fee,
    organizer_type: 'member',
    organizer_id: botMemberId,
    organizer_name_text: e.organizer || '印西市文化ホール',
    proxy_registration: true,
    proxy_source_url: e.detailUrl ?? calendarUrl,
    external_source: INZAI_BUNKA_SOURCE,
    external_source_id: e.sourceId,
    flyer_image_url: flyerImageUrl,
    status: 'open',
  }
}

const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()

/** 既存行と比較して変わった項目だけを返す（空なら更新不要） */
export function diffRow(existing: ExistingEventRow, row: EventRow): Partial<EventRow> {
  const patch: Partial<EventRow> = {}
  if (existing.title !== row.title) patch.title = row.title
  if (existing.description !== row.description) patch.description = row.description
  if (!sameInstant(existing.start_at, row.start_at)) patch.start_at = row.start_at
  if (!sameInstant(existing.end_at, row.end_at)) patch.end_at = row.end_at
  if ((existing.location ?? '') !== row.location) patch.location = row.location
  if ((existing.fee === null ? null : Number(existing.fee)) !== row.fee) patch.fee = row.fee
  if (existing.capacity !== row.capacity) patch.capacity = row.capacity
  if ((existing.organizer_name_text ?? '') !== row.organizer_name_text) patch.organizer_name_text = row.organizer_name_text
  if ((existing.proxy_source_url ?? '') !== row.proxy_source_url) patch.proxy_source_url = row.proxy_source_url
  // 画像は「まだ無い→取れた」ときだけ付ける（既にあるものは差し替えない）
  if (!existing.flyer_image_url && row.flyer_image_url) patch.flyer_image_url = row.flyer_image_url
  return patch
}

export async function syncInzaiBunka(db: SyncDb, opts: SyncOptions): Promise<SyncResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const log = opts.log ?? (() => {})
  const now = opts.now ?? new Date()
  const dryRun = !!opts.dryRun
  const result: SyncResult = {
    ok: true,
    fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
    inserted: [],
    updated: [],
    unchanged: 0,
    skipped: [],
    duplicates: [],
    errors: [],
    dryRun,
  }

  // 1. 公演一覧
  const listHtml = await fetchText(fetchFn, INZAI_BUNKA_EVENT_LIST_URL)
  const items = parseEventListHtml(listHtml)
  result.fetched.list = items.length
  if (items.length === 0) {
    // 構造変更か障害。誤って全件更新しないようここで止める
    result.ok = false
    result.errors.push('公演一覧が0件（サイト構造の変更か取得失敗）。同期を中止')
    return result
  }
  for (const it of items) {
    if (it.isRange) result.skipped.push(`募集案内: ${it.title}`)
    else if (it.dates.length === 0) result.skipped.push(`日付が読めない: ${it.title} (${it.dateText})`)
  }

  // 2. 詳細ページ（並列4）
  const targets = items.filter((it) => !it.isRange && it.dates.length > 0)
  const fromList = (
    await mapLimit(targets, DETAIL_CONCURRENCY, async (it) => {
      try {
        const html = await fetchText(fetchFn, it.url)
        result.fetched.details++
        return listItemToEntries(it, parseEventDetailHtml(html))
      } catch (e) {
        result.fetched.detailFailed++
        log(`detail failed ${it.url}: ${e instanceof Error ? e.message : String(e)}`)
        return listItemToEntries(it, null)
      }
    })
  ).flat()

  // 3. 月別カレンダー（貸館公演の補完）
  const fromCalendar: BunkaCalendarEntry[] = []
  for (const { year, month } of upcomingMonths(now, CALENDAR_MONTHS)) {
    try {
      const html = await fetchText(fetchFn, buildCalendarUrl(year, month))
      const es = parseCalendarHtml(html, year, month)
      result.fetched.calendar += es.length
      fromCalendar.push(...es)
    } catch (e) {
      result.errors.push(`calendar ${year}-${month}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 4. 突き合わせ → 今日以降
  const merged = mergeEntries(fromList, fromCalendar)
  result.fetched.merged = merged.length
  const today = todayJst(now)
  const future = merged.filter((e) => {
    if (e.date < today) return false
    // カレンダーにだけ載る「○○募集」（詳細ページ無し）は募集案内なので公演としては登録しない
    if (!e.detailUrl && /募集/.test(e.title)) {
      result.skipped.push(`募集案内: ${e.title}`)
      return false
    }
    return true
  })
  result.fetched.future = future.length

  // 5. 既存行（この同期が登録したもの）と、手動登録など他の経路の今後のイベント（重複判定用）
  const existingRows = await db.listExisting()
  const existing = new Map(existingRows.map((r) => [r.external_source_id, r]))
  const others = await db.listOtherFutureEvents(today)

  // 6. 画像（投稿IDごとに1回だけ取得。既存行に画像があれば再利用）
  const imageCache = new Map<string, string | null>()
  const flyerFor = async (e: BunkaCalendarEntry): Promise<string | null> => {
    const postId = /^post:(\d+):/.exec(e.sourceId)?.[1]
    if (!postId || !e.imageUrl) return null
    if (imageCache.has(postId)) return imageCache.get(postId) ?? null
    const reused = existingRows.find((r) => r.external_source_id.startsWith(`post:${postId}:`) && r.flyer_image_url)
    if (reused?.flyer_image_url) {
      imageCache.set(postId, reused.flyer_image_url)
      return reused.flyer_image_url
    }
    if (dryRun) {
      imageCache.set(postId, null)
      return null
    }
    try {
      const res = await fetchFn(e.imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : ct === 'image/gif' ? 'gif' : ct === 'image/jpeg' ? 'jpg' : null
      if (!ext) throw new Error(`unsupported content-type ${ct}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`size ${bytes.length}`)
      const url = await db.uploadFlyer(`inzai-bunka/${postId}.${ext}`, bytes, ct)
      imageCache.set(postId, url)
      return url
    } catch (err) {
      log(`image failed ${e.imageUrl}: ${err instanceof Error ? err.message : String(err)}`)
      imageCache.set(postId, null)
      return null
    }
  }

  // 7. insert / update
  for (const e of future) {
    try {
      const ex = existing.get(e.sourceId)
      // 画像取得は「新規で重複でない」か「既存」のときだけ（重複スキップ分の画像を無駄に取らない）
      const flyer = !ex && findManualDuplicate(e, others) ? null : await flyerFor(e)
      const row = entryToRow(e, opts.botMemberId, flyer)
      if (!ex) {
        // チラシから手で登録済みのもの（この同期を導入する前の運用）は二重に載せない。既存行はそのまま
        const dup = findManualDuplicate(e, others)
        if (dup) {
          result.duplicates.push(`${e.date} ${row.title} ≈ 既存「${dup.title}」(${dup.id})`)
          continue
        }
        if (!dryRun) await db.insert(row)
        result.inserted.push(`${e.date} ${row.title}`)
        continue
      }
      const patch = diffRow(ex, row)
      if (Object.keys(patch).length === 0) {
        result.unchanged++
        continue
      }
      if (!dryRun) await db.update(ex.id, patch)
      result.updated.push(`${e.date} ${row.title} [${Object.keys(patch).join(',')}]`)
    } catch (err) {
      result.ok = false
      result.errors.push(`${e.sourceId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
