// 号外NET の記事から拾ったコスモスパレットの催しを、CiDAO の events に「下書き」として入れる本体。
//
// 流れ: REST 検索（コスモスパレット）→ 記事ごとに候補を抽出 → 同じ催しの重複を除く → 今日以降
//       → 既存（同じ記事×日付）が無ければ status='draft' で insert
//       → 既存が draft なら記事の変更を反映（update）。open／cancelled（公開済み・見送り）は触らない
//       → 他の経路で登録済み（同日・コスモスパレット・似た題名）のものは insert しない
// 運営は管理画面「イベント一括取り込み」で候補を見て「公開」（open）か「見送り」（cancelled）を押す。

import { jstLocalToUtcIso } from '@/lib/datetime'
import {
  findDuplicateEvent,
  todayJst,
  type EventRow,
  type OtherEventRow,
  type SyncOptions,
  type SyncResult,
} from '@/lib/inzai-bunka/sync'
import {
  GOGUYNET_COSMOS_SOURCE,
  buildSearchUrl,
  dedupeCandidates,
  extractCandidates,
  toCandidateDescription,
  type CosmosCandidate,
  type GoguynetPost,
} from './cosmos'

const FETCH_TIMEOUT_MS = 15_000
const COSMOS_PLACE_RE = /コスモスパレット|cosmos\s*palette/i

export type CosmosExistingRow = {
  id: string
  external_source_id: string
  status: string
  title: string
  description: string
  start_at: string
  end_at: string
  location: string | null
  fee: number | null
}

export type CosmosSyncDb = {
  listExisting(): Promise<CosmosExistingRow[]>
  listOtherFutureEvents(fromDate: string): Promise<OtherEventRow[]>
  insert(row: EventRow): Promise<void>
  update(id: string, patch: Partial<EventRow>): Promise<void>
}

export function candidateToRow(c: CosmosCandidate, botMemberId: string): EventRow {
  return {
    title: c.title,
    description: toCandidateDescription(c),
    category: 'machizukuri',
    start_at: jstLocalToUtcIso(c.startAt),
    end_at: jstLocalToUtcIso(c.endAt),
    location: c.venue,
    online_flag: false,
    capacity: null,
    fee: c.fee,
    organizer_type: 'member',
    organizer_id: botMemberId,
    organizer_name_text: 'コスモスパレット（号外NET の記事より）',
    proxy_registration: true,
    proxy_source_url: c.articleUrl,
    external_source: GOGUYNET_COSMOS_SOURCE,
    external_source_id: c.sourceId,
    flyer_image_url: null,
    status: 'draft',
  }
}

const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()

export function diffDraft(existing: CosmosExistingRow, row: EventRow): Partial<EventRow> {
  const patch: Partial<EventRow> = {}
  if (existing.title !== row.title) patch.title = row.title
  if (existing.description !== row.description) patch.description = row.description
  if (!sameInstant(existing.start_at, row.start_at)) patch.start_at = row.start_at
  if (!sameInstant(existing.end_at, row.end_at)) patch.end_at = row.end_at
  if ((existing.location ?? '') !== row.location) patch.location = row.location
  if ((existing.fee === null ? null : Number(existing.fee)) !== row.fee) patch.fee = row.fee
  return patch
}

export async function syncGoguynetCosmos(db: CosmosSyncDb, opts: SyncOptions): Promise<SyncResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const log = opts.log ?? (() => {})
  const now = opts.now ?? new Date()
  const dryRun = !!opts.dryRun
  const result: SyncResult = {
    ok: true,
    fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
    inserted: [], updated: [], unchanged: 0, skipped: [], duplicates: [], errors: [], dryRun,
  }

  // 1. 記事検索
  const res = await fetchFn(buildSearchUrl(), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; CiDAO-event-sync/1.0; +https://cidao.vercel.app)', accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`号外NET HTTP ${res.status}`)
  const posts = (await res.json()) as GoguynetPost[]
  if (!Array.isArray(posts)) throw new Error('号外NET の応答が配列ではない')
  result.fetched.list = posts.length

  // 2. 候補抽出（記事＝details として数える）
  const all: CosmosCandidate[] = []
  for (const p of posts) {
    const cands = extractCandidates(p)
    if (cands.length === 0) {
      result.skipped.push(`候補なし: ${p.title.rendered.slice(0, 40)}`)
      continue
    }
    result.fetched.details++
    all.push(...cands)
  }
  const merged = dedupeCandidates(all)
  result.fetched.merged = merged.length
  const today = todayJst(now)
  const future = merged.filter((c) => c.date >= today)
  result.fetched.future = future.length

  // 3. 既存・他経路
  const existingRows = await db.listExisting()
  const existing = new Map(existingRows.map((r) => [r.external_source_id, r]))
  const others = await db.listOtherFutureEvents(today)

  // 4. insert（下書き）／update（下書きのみ）
  for (const c of future) {
    try {
      const row = candidateToRow(c, opts.botMemberId)
      const ex = existing.get(c.sourceId)
      if (!ex) {
        const dup = findDuplicateEvent(c, others, COSMOS_PLACE_RE)
        if (dup) {
          result.duplicates.push(`${c.date} ${row.title} ≈ 既存「${dup.title}」(${dup.id})`)
          continue
        }
        if (!dryRun) await db.insert(row)
        result.inserted.push(`${c.date} ${row.title}`)
        continue
      }
      if (ex.status !== 'draft') {
        result.unchanged++ // 公開済み・見送りは運営の判断を尊重して触らない
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
      log(String(err))
    }
  }
  return result
}
