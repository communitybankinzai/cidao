// 印西市サイトの催しを CiDAO の events に「下書き」として入れる本体（号外NET の同期と同じ流儀）。
//   月別カレンダー（当月＋2か月）→ 各ページ → 候補 → 今日以降
//   → 無ければ status='draft' で insert／draft なら市ページの変更を反映／open・cancelled は触らない
//   → 他の経路（広報いんざい取り込み・手動）で同日・似た題名があれば insert しない

import { jstLocalToUtcIso } from '@/lib/datetime'
import { upcomingMonths } from '@/lib/inzai-bunka/calendar'
import { findDuplicateEvent, todayJst, type EventRow, type OtherEventRow, type SyncOptions, type SyncResult } from '@/lib/inzai-bunka/sync'
import type { CosmosExistingRow, CosmosSyncDb } from '@/lib/goguynet/sync'
import { diffDraft } from '@/lib/goguynet/sync'
import {
  INZAI_CITY_SOURCE,
  buildCityCalendarUrl,
  cityItemToCandidates,
  cityKindToCategory,
  parseCityCalendarHtml,
  parseCityDetailHtml,
  toCityDescription,
  type CityCandidate,
} from './calendar'

export const CITY_CALENDAR_MONTHS = 3
const DETAIL_CONCURRENCY = 4
const FETCH_TIMEOUT_MS = 15_000

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
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export function cityCandidateToRow(c: CityCandidate, botMemberId: string): EventRow {
  return {
    title: c.title,
    description: toCityDescription(c),
    category: cityKindToCategory(c.kind),
    start_at: jstLocalToUtcIso(c.startAt),
    end_at: jstLocalToUtcIso(c.endAt),
    location: c.venue || '印西市内（市のページをご確認ください）',
    online_flag: false,
    capacity: null,
    fee: c.fee,
    organizer_type: 'member',
    organizer_id: botMemberId,
    organizer_name_text: c.organizer,
    proxy_registration: true,
    proxy_source_url: c.detailUrl ?? '',
    external_source: INZAI_CITY_SOURCE,
    external_source_id: c.sourceId,
    flyer_image_url: null,
    status: 'draft',
  }
}

export async function syncInzaiCity(db: CosmosSyncDb, opts: SyncOptions): Promise<SyncResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const log = opts.log ?? (() => {})
  const now = opts.now ?? new Date()
  const dryRun = !!opts.dryRun
  const result: SyncResult = {
    ok: true,
    fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
    inserted: [], updated: [], unchanged: 0, skipped: [], duplicates: [], errors: [], dryRun,
  }

  // 1. 月別カレンダー（無い月は 404 なので飛ばす。全月 404/0件なら失敗）
  const itemsByUrl = new Map<string, ReturnType<typeof parseCityCalendarHtml>[number]>()
  let okMonths = 0
  for (const { year, month } of upcomingMonths(now, CITY_CALENDAR_MONTHS)) {
    try {
      const html = await fetchText(fetchFn, buildCityCalendarUrl(year, month))
      const items = parseCityCalendarHtml(html, year, month)
      okMonths++
      result.fetched.calendar += items.length
      for (const it of items) {
        const ex = itemsByUrl.get(it.url)
        if (ex) ex.dates = Array.from(new Set([...ex.dates, ...it.dates])).sort()
        else itemsByUrl.set(it.url, { ...it })
      }
    } catch (e) {
      result.skipped.push(`カレンダー ${year}-${month}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (okMonths === 0) throw new Error('市サイトのカレンダーが1か月も読めなかった')
  const items = Array.from(itemsByUrl.values())
  result.fetched.list = items.length

  // 2. 各ページ（並列4）
  const candidates: CityCandidate[] = (
    await mapLimit(items, DETAIL_CONCURRENCY, async (it) => {
      try {
        const html = await fetchText(fetchFn, it.url)
        result.fetched.details++
        return cityItemToCandidates(it, parseCityDetailHtml(html))
      } catch (e) {
        result.fetched.detailFailed++
        log(`detail failed ${it.url}: ${e instanceof Error ? e.message : String(e)}`)
        return cityItemToCandidates(it, null)
      }
    })
  ).flat()
  result.fetched.merged = candidates.length
  const today = todayJst(now)
  const future = candidates.filter((c) => c.date >= today)
  result.fetched.future = future.length

  // 3. 既存・他経路
  const existingRows: CosmosExistingRow[] = await db.listExisting()
  const existing = new Map(existingRows.map((r) => [r.external_source_id, r]))
  const others: OtherEventRow[] = await db.listOtherFutureEvents(today)

  // 4. insert（下書き）／update（下書きのみ）
  for (const c of future) {
    try {
      const row = cityCandidateToRow(c, opts.botMemberId)
      const ex = existing.get(c.sourceId)
      if (!ex) {
        // 市主催の催しは会場がばらばらなので、会場は問わず「同じ日に似た題名」で重複とみなす
        const dup = findDuplicateEvent(c, others, /./)
        if (dup) {
          result.duplicates.push(`${c.date} ${row.title} ≈ 既存「${dup.title}」(${dup.id})`)
          continue
        }
        if (!dryRun) await db.insert(row)
        result.inserted.push(`${c.date} ${row.title}`)
        continue
      }
      if (ex.status !== 'draft') {
        result.unchanged++
        continue
      }
      const patch = diffDraft(ex, row)
      if (Object.keys(patch).length === 0) {
        result.unchanged++
        continue
      }
      if (!dryRun) await db.update(ex.id, patch)
      result.updated.push(`${c.date} ${row.title} [${Object.keys(patch).join(',')}]`)
    } catch (err) {
      result.ok = false
      result.errors.push(`${c.sourceId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
