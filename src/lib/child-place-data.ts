// 「こどもの居場所カレンダー」の実績（掲載の状況・根拠の一覧・CSV）の元データを読む。
// 専用ページ（/events/kodomo）と CSV（/events/kodomo/csv）で同じ数字になるよう、読み方を1か所にまとめる。
import type { SupabaseClient } from '@supabase/supabase-js'
import { summarizeChildPlace, type ChildPlaceEventRow, type ChildPlaceSummary } from './child-place'
import { buildEvidenceRows, organizerDisplayName, type ChildPlaceRecord, type EvidenceRow } from './child-place-evidence'

export type ChildPlaceReport = {
  summary: ChildPlaceSummary
  evidence: EvidenceRow[]
  generatedAt: Date
}

const COLUMNS =
  'id, title, start_at, location, child_place, child_place_checked, organizer_type, organizer_id, organizer_name_text, proxy_source_url, website_url, external_source, attendee_count, attendee_count_source'

// 公開中（status=open）で目印のあるイベントだけ。中止・下書きは数えない。
export async function loadChildPlaceReport(supabase: SupabaseClient, now: Date = new Date()): Promise<ChildPlaceReport> {
  const { data } = await supabase
    .from('events')
    .select(COLUMNS)
    .eq('status', 'open')
    .not('child_place', 'is', null)
    .order('start_at', { ascending: true })
    .limit(5000)
  const records = (data ?? []) as ChildPlaceRecord[]

  const orgIds = Array.from(new Set(records.filter((r) => r.organizer_type === 'org').map((r) => r.organizer_id)))
  const orgNames: Record<string, string> = {}
  if (orgIds.length) {
    const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', orgIds)
    for (const o of (orgs ?? []) as { id: string; name: string }[]) orgNames[o.id] = o.name
  }

  const summaryRows: ChildPlaceEventRow[] = records.map((r) => ({
    start_at: r.start_at,
    child_place: r.child_place,
    child_place_checked: r.child_place_checked,
    organizer_name: organizerDisplayName(r, orgNames),
    attendee_count: r.attendee_count,
  }))

  return {
    summary: summarizeChildPlace(summaryRows, now.getTime()),
    evidence: buildEvidenceRows(records, orgNames, now.getTime()),
    generatedAt: now,
  }
}
