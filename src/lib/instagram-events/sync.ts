// Instagram #印西 の直近24時間の投稿から、チラシ画像を AI で読み取り、CiDAO の events に
// 「下書き候補」（external_source='instagram-hashtag'・status='draft'）として入れる本体。
//
// 流れ: ハッシュタグ検索 → 一次ふるい（本文に日付＋催しの語・画像あり・未読み取り）
//       → 今月の読み取り費用が上限（既定 500 円・運営決定 2026-10-01）未満なら画像を読み取る
//       → 画像の SHA-256 で「チラシ画像から取り込む」との重複、同日・似た題名で他の経路との重複を除く
//       → 今日以降の日程ごとに draft で insert（画像は転載せず、投稿リンクを出典に付ける）
// 運営は管理画面「イベント一括取り込み」の候補一覧で「公開」か「見送り」を押す。
//
// テストしやすいよう fetch・DB・AI 読み取りは引数で差し替えられる（route.ts が本物を渡す）。

import { createHash } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { jstLocalToUtcIso } from '@/lib/datetime'
import { extractFromFlyer, type FlyerExtract, type FlyerMediaType } from '@/lib/event-flyer-extract'
import { isSimilarTitle, todayJst, type EventRow, type OtherEventRow, type SyncOptions, type SyncResult } from '@/lib/inzai-bunka/sync'
import type { AIUsage } from '@/lib/ai/types'
import {
  INSTAGRAM_EVENT_HASHTAG,
  INSTAGRAM_HASHTAG_SOURCE,
  captionHint,
  fetchHashtagRecentMedia,
  looksLikeEventPost,
  pickImageUrl,
  type IgMedia,
} from './hashtag'

/** api_usage の purpose。管理画面の費用表示とここの予算判定が同じ値を見る */
export const INSTAGRAM_SCAN_PURPOSE = 'event_scan_instagram'
export const DEFAULT_SCAN_MODEL = 'claude-sonnet-5'
export const DEFAULT_BUDGET_JPY = 500
/** 1回の巡回で読み取る画像の上限。1枚 1〜3 円なので 1 日あたり 20〜40 円以内に収まる */
export const DEFAULT_MAX_SCANS_PER_RUN = 12
/** 1回の実行に使える時間（ms）。route.ts の maxDuration より短くし、ページ送りは前半・読み取りは後半で打ち切る */
export const DEFAULT_TIME_BUDGET_MS = 100_000
const SCAN_CONCURRENCY = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MIN_CONFIDENCE = 0.5
const TITLE_MAX = 80 // events.title / organizer_name_text の CHECK 制約
const FETCH_TIMEOUT_MS = 15_000
const ASSUMED_START = '09:00'
const ASSUMED_END = '17:00'

export type IgSyncDb = {
  loadDiscoveryAuth(): Promise<{ user_id: string; access_token: string } | null>
  /** 既に候補にした（見送り・公開済みを含む）投稿の external_source_id 一覧（ig:<投稿ID>:<日付>） */
  listExistingSourceIds(): Promise<string[]>
  /** 直近の実行で読み取り済みの投稿ID（候補にならなかったものを含む。同じ投稿を翌日また読んで費用を払わないため） */
  listRecentlyScannedIds(): Promise<string[]>
  /** fromDate（JST の日付）以降の全イベント（情報源を問わない。同日・似た題名の重複判定に使う） */
  listFutureEvents(fromDate: string): Promise<OtherEventRow[]>
  /** 同じ画像（SHA-256）が管理画面「チラシ画像から取り込む」で登録済みか */
  hasEventWithSourceId(sourceId: string): Promise<boolean>
  /** 今月（JST）の読み取り費用の合計（円） */
  monthCostJpy(): Promise<number>
  insert(row: EventRow): Promise<void>
  /** 1回の読み取りの使用量を api_usage に残し、推定費用（円）を返す */
  recordUsage(args: { model: string; usage: AIUsage | null; error: string | null }): Promise<number | null>
}

export type IgSyncOptions = SyncOptions & {
  apiKey: string
  model?: string
  budgetJpy?: number
  maxScansPerRun?: number
  hashtag?: string
  extract?: typeof extractFromFlyer
  timeBudgetMs?: number
}

export type IgPrefilterCounts = { noImage: number; noDate: number; noEventWord: number; notEvent: number; already: number; passed: number }

export type IgSyncResult = SyncResult & {
  /** 今回 AI に読ませた投稿ID（候補にならなかったものを含む）。event_sync_runs.detail に残して次回の再読み取りを防ぐ */
  scanned: string[]
  costJpy: number
  budget: { monthBeforeJpy: number; limitJpy: number; exhausted: boolean }
  prefilter: IgPrefilterCounts
}

/** fetched の意味（この取り込みでは）: list=取得した投稿, calendar=一次ふるい通過, details=AI に読ませた画像,
 *  detailFailed=画像取得／読み取りの失敗, merged=読み取れた日程, future=今日以降の日程 */
function emptyResult(dryRun: boolean, limitJpy: number): IgSyncResult {
  return {
    ok: true,
    fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
    inserted: [], updated: [], unchanged: 0, skipped: [], duplicates: [], errors: [], dryRun,
    scanned: [], costJpy: 0,
    budget: { monthBeforeJpy: 0, limitJpy, exhausted: false },
    prefilter: { noImage: 0, noDate: 0, noEventWord: 0, notEvent: 0, already: 0, passed: 0 },
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function sniffImageType(buf: Buffer, contentType: string): FlyerMediaType | null {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'image/jpeg'
  if (ct === 'image/png' || ct === 'image/gif' || ct === 'image/webp') return ct
  if (buf.length >= 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
    if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif'
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  }
  return null
}

export async function downloadImage(fetchFn: typeof fetch, url: string): Promise<{ buf: Buffer; type: FlyerMediaType }> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error('空の応答')
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`画像が大きすぎる（${Math.round(buf.length / 1024)}KB）`)
  const type = sniffImageType(buf, res.headers.get('content-type') ?? '')
  if (!type) throw new Error(`画像ではない（${res.headers.get('content-type') ?? 'content-type なし'}）`)
  return { buf, type }
}

export function toAIUsage(usage: Anthropic.Usage): AIUsage {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
  }
}

const LOCAL_DT_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/

/** 「YYYY-MM-DDTHH:MM」に揃える。日付だけなら時間は null（仮置きの対象） */
function parseLocal(s: string | null | undefined): { date: string; time: string | null } | null {
  if (!s) return null
  const m = LOCAL_DT_RE.exec(s.trim())
  if (!m) return null
  const date = m[1]
  if (Number.isNaN(new Date(`${date}T00:00:00+09:00`).getTime())) return null
  return { date, time: m[2] ? `${m[2]}:${m[3]}` : null }
}

function plusHours(local: string, hours: number): string {
  const d = new Date(`${local}:00+09:00`)
  d.setTime(d.getTime() + hours * 3_600_000)
  const jst = new Date(d.getTime() + 9 * 3_600_000)
  return jst.toISOString().slice(0, 16)
}

export type Occurrence = { start_at: string; end_at: string; timeAssumed: boolean }

/** 抽出結果の日程を 1 日 1 件に揃える。終了が無い／開始より前なら開始の 2 時間後 */
export function occurrencesOf(d: FlyerExtract): Occurrence[] {
  const list =
    Array.isArray(d.occurrences) && d.occurrences.length > 0
      ? d.occurrences
      : d.start_at
        ? [{ start_at: d.start_at, end_at: d.end_at ?? '' }]
        : []
  const out: Occurrence[] = []
  const seen = new Set<string>()
  for (const o of list) {
    const s = parseLocal(o?.start_at)
    if (!s || seen.has(s.date)) continue
    seen.add(s.date)
    const e = parseLocal(o?.end_at)
    if (!s.time) {
      out.push({ start_at: `${s.date}T${ASSUMED_START}`, end_at: `${e?.date ?? s.date}T${ASSUMED_END}`, timeAssumed: true })
      continue
    }
    const start = `${s.date}T${s.time}`
    let end = e ? `${e.date}T${e.time ?? ASSUMED_END}` : ''
    if (!end || end < start) end = plusHours(start, 2)
    out.push({ start_at: start, end_at: end, timeAssumed: false })
  }
  return out
}

function clip(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function toCandidateDescription(d: FlyerExtract, media: IgMedia, hashtag: string, timeAssumed: boolean): string {
  const lines: string[] = []
  if (d.description?.trim()) lines.push(d.description.trim(), '')
  if (d.organizer_name?.trim()) lines.push(`主催：${d.organizer_name.trim()}`)
  if (timeAssumed) lines.push(`※ 時間はチラシから読み取れなかったため ${ASSUMED_START}〜${ASSUMED_END} を仮置きしています`)
  lines.push(`出典：Instagram の #${hashtag} の投稿 ${media.permalink}`)
  lines.push('※ Instagram の公開投稿の画像から AI が読み取った候補です。日時・会場・料金は元の投稿で確認してください。')
  return lines.join('\n')
}

export function candidateToRow(d: FlyerExtract, occ: Occurrence, media: IgMedia, botMemberId: string, hashtag: string): EventRow {
  const organizer = d.organizer_name?.trim() || '主催者不明'
  return {
    title: clip(d.title || '（題名なし）', TITLE_MAX),
    description: toCandidateDescription(d, media, hashtag, occ.timeAssumed),
    category: 'machizukuri',
    start_at: jstLocalToUtcIso(occ.start_at),
    end_at: jstLocalToUtcIso(occ.end_at),
    location: d.location?.trim() || '',
    online_flag: !!d.online_flag,
    capacity: typeof d.capacity === 'number' && d.capacity > 0 ? Math.floor(d.capacity) : null,
    fee: typeof d.fee === 'number' && d.fee >= 0 ? Math.floor(d.fee) : null,
    organizer_type: 'member',
    organizer_id: botMemberId,
    organizer_name_text: clip(`${organizer}（Instagram #${hashtag} の投稿より）`, TITLE_MAX),
    proxy_registration: true,
    proxy_source_url: media.permalink,
    external_source: INSTAGRAM_HASHTAG_SOURCE,
    external_source_id: `ig:${media.id}:${occ.start_at.slice(0, 10)}`,
    flyer_image_url: null,
    status: 'draft',
  }
}

/** 同じ日（JST）に似た題名の既存イベントがあれば返す（会場は問わない） */
export function findDuplicateByDateTitle(title: string, date: string, others: OtherEventRow[]): OtherEventRow | null {
  for (const o of others) {
    if (todayJst(new Date(o.start_at)) !== date) continue
    if (isSimilarTitle(title, o.title)) return o
  }
  return null
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function syncInstagramEvents(db: IgSyncDb, opts: IgSyncOptions): Promise<IgSyncResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const log = opts.log ?? (() => {})
  const now = opts.now ?? new Date()
  const dryRun = !!opts.dryRun
  const model = opts.model ?? DEFAULT_SCAN_MODEL
  const limitJpy = opts.budgetJpy ?? DEFAULT_BUDGET_JPY
  const maxScans = opts.maxScansPerRun ?? DEFAULT_MAX_SCANS_PER_RUN
  const extract = opts.extract ?? extractFromFlyer
  const hashtag = opts.hashtag ?? INSTAGRAM_EVENT_HASHTAG
  const today = todayJst(now)
  const result = emptyResult(dryRun, limitJpy)
  const startedMs = Date.now()
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const pagingDeadline = startedMs + timeBudgetMs * 0.45
  const scanDeadline = startedMs + timeBudgetMs * 0.85

  const auth = await db.loadDiscoveryAuth()
  if (!auth) throw new Error('Instagram 検索用トークンが未設定です（/admin/sns の「Instagram検索専用」欄で登録）')

  // 1. 直近24時間の投稿
  const { media, pages, truncated } = await fetchHashtagRecentMedia(fetchFn, { userId: auth.user_id, token: auth.access_token, hashtag, deadline: pagingDeadline })
  result.fetched.list = media.length
  log(`#${hashtag}: ${media.length} 件（${pages} ページ${truncated ? '・時間切れで打ち切り' : ''}）`)
  if (truncated) result.skipped.push(`投稿が多く ${pages} ページ（${media.length} 件）で打ち切り（取得に時間がかかるため。それ以降の投稿は見ていない）`)

  // 2. 一次ふるい（AI 不使用）
  const [existingIds, scannedIds] = await Promise.all([db.listExistingSourceIds(), db.listRecentlyScannedIds()])
  const existingSet = new Set(existingIds)
  const knownPosts = new Set<string>(scannedIds)
  for (const id of existingIds) {
    const m = /^ig:([^:]+):/.exec(id)
    if (m) knownPosts.add(m[1])
  }
  const candidates: IgMedia[] = []
  for (const m of media) {
    if (knownPosts.has(m.id)) {
      result.prefilter.already++
      continue
    }
    const pf = looksLikeEventPost(m)
    if (!pf.ok) {
      if (pf.reason === 'no_image') result.prefilter.noImage++
      else if (pf.reason === 'no_date') result.prefilter.noDate++
      else if (pf.reason === 'no_event_word') result.prefilter.noEventWord++
      else result.prefilter.notEvent++
      continue
    }
    candidates.push(m)
  }
  // 新しい投稿を優先して読む（1回の上限を超えた分は読まない）
  candidates.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0))
  result.prefilter.passed = candidates.length
  result.fetched.calendar = candidates.length
  log(`一次ふるい通過 ${candidates.length} 件（画像なし ${result.prefilter.noImage}・日付なし ${result.prefilter.noDate}・催しの語なし ${result.prefilter.noEventWord}・対象外 ${result.prefilter.notEvent}・読み取り済み ${result.prefilter.already}）`)
  if (candidates.length === 0) return result

  // 3. 予算（今月の読み取り費用）
  const monthBefore = await db.monthCostJpy()
  result.budget.monthBeforeJpy = monthBefore
  if (monthBefore >= limitJpy) {
    result.budget.exhausted = true
    result.skipped.push(`今月の読み取り費用が上限（${limitJpy} 円）に達しているため ${candidates.length} 件を読み取らずに終了（今月 ${Math.round(monthBefore)} 円）`)
    log(result.skipped[result.skipped.length - 1])
    return result
  }
  const toScan = candidates.slice(0, maxScans)
  if (candidates.length > toScan.length) {
    result.skipped.push(`1回の上限 ${maxScans} 件を超えた ${candidates.length - toScan.length} 件は読み取らず（古い投稿から）`)
  }

  // 4. 画像を読み取り、重複を除いて行を作る
  const future = await db.listFutureEvents(today)
  const newRows: EventRow[] = []
  const labelOf = (row: EventRow) => `${row.title}（${row.external_source_id.split(':').pop()}）`

  await mapLimit(toScan, SCAN_CONCURRENCY, async (m) => {
    if (result.budget.exhausted) {
      result.skipped.push(`${m.permalink} 予算上限に達したため未読み取り`)
      return
    }
    if (Date.now() > scanDeadline) {
      result.skipped.push(`${m.permalink} 時間切れのため未読み取り`)
      return
    }
    const imageUrl = pickImageUrl(m)
    if (!imageUrl) return
    let img: { buf: Buffer; type: FlyerMediaType }
    try {
      img = await downloadImage(fetchFn, imageUrl)
    } catch (e) {
      result.fetched.detailFailed++
      result.skipped.push(`${m.permalink} 画像取得失敗: ${errMessage(e)}`)
      return
    }
    const hash = sha256(img.buf)
    if (await db.hasEventWithSourceId(hash)) {
      result.scanned.push(m.id)
      result.duplicates.push(`${m.permalink} 同じ画像が「チラシ画像から取り込む」で登録済み`)
      return
    }

    result.fetched.details++
    const r = await extract(opts.apiKey, img.buf.toString('base64'), img.type, {
      model, logTag: 'instagram-events-sync', now, hint: captionHint(m.caption),
    })
    const cost = await db.recordUsage({ model, usage: r.usage ? toAIUsage(r.usage) : null, error: r.ok ? null : r.reason })
    result.costJpy += cost ?? 0
    if (monthBefore + result.costJpy >= limitJpy) result.budget.exhausted = true
    result.scanned.push(m.id)

    if (!r.ok) {
      result.fetched.detailFailed++
      result.skipped.push(`${m.permalink} 読み取り失敗（${r.reason}）`)
      return
    }
    const d = r.data
    if (!d || d.title === '（読み取り失敗）' || !(d.confidence >= MIN_CONFIDENCE)) {
      result.skipped.push(`${m.permalink} チラシではない／自信度 ${d?.confidence ?? '?'}`)
      return
    }
    const occs = occurrencesOf(d)
    if (occs.length === 0) {
      result.skipped.push(`${m.permalink} 日時が読み取れない`)
      return
    }
    result.fetched.merged += occs.length
    // ここから下は await が無い（同じ催しを並行して二重に積まないため）
    for (const occ of occs) {
      const date = occ.start_at.slice(0, 10)
      if (date < today) {
        result.skipped.push(`${d.title}（${date}）は過去`)
        continue
      }
      result.fetched.future++
      const sourceId = `ig:${m.id}:${date}`
      if (existingSet.has(sourceId)) {
        result.unchanged++
        continue
      }
      const dup = findDuplicateByDateTitle(d.title, date, future) ?? findDuplicateByDateTitle(d.title, date, newRows.map((r2) => ({ id: '', title: r2.title, start_at: r2.start_at, location: r2.location, organizer_name_text: r2.organizer_name_text })))
      if (dup) {
        result.duplicates.push(`${d.title}（${date}）= 既存「${dup.title}」`)
        continue
      }
      newRows.push(candidateToRow(d, occ, m, opts.botMemberId, hashtag))
    }
  })

  // 5. 登録
  for (const row of newRows) {
    const label = labelOf(row)
    if (dryRun) {
      result.inserted.push(label)
      continue
    }
    try {
      await db.insert(row)
      result.inserted.push(label)
    } catch (e) {
      result.errors.push(`insert ${label}: ${errMessage(e)}`)
    }
  }
  result.ok = result.errors.length === 0
  log(`読み取り ${result.fetched.details} 件・約 ${Math.round(result.costJpy)} 円 → 候補 ${result.inserted.length} 件・重複 ${result.duplicates.length}・見送り ${result.skipped.length}`)
  return result
}
