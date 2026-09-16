// 外部サイトからのイベント自動取り込み（文化ホール・号外NET 等）の実行記録を event_sync_runs に1行残す。
// 管理画面「イベント一括取り込み」が読む。失敗しても同期結果は返す（記録失敗はログのみ）。

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncResult } from '@/lib/inzai-bunka/sync'

export async function recordSyncRun(supabase: SupabaseClient, source: string, startedAt: Date, r: SyncResult): Promise<void> {
  const { error } = await supabase.from('event_sync_runs').insert({
    source,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    ok: r.ok,
    dry_run: r.dryRun,
    fetched: r.fetched,
    inserted: r.inserted.length,
    updated: r.updated.length,
    unchanged: r.unchanged,
    duplicates: r.duplicates.length,
    skipped: r.skipped.length,
    errors: r.errors,
    detail: { inserted: r.inserted, updated: r.updated, duplicates: r.duplicates, skipped: r.skipped },
  })
  if (error) console.error(`[event-sync] recordSyncRun(${source}) failed:`, error.message)
}

export function emptyFailedResult(message: string, dryRun: boolean): SyncResult {
  return {
    ok: false,
    fetched: { list: 0, details: 0, detailFailed: 0, calendar: 0, merged: 0, future: 0 },
    inserted: [], updated: [], unchanged: 0, skipped: [], duplicates: [], errors: [message], dryRun,
  }
}
