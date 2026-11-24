// 主催者の開催実績の元データを DB から集める（画面と CSV で共通）。管理者として開いたセッションの Supabase クライアントを渡すこと。
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildOrganizerReport,
  type OrganizerAliasRow,
  type OrganizerEventRow,
  type OrganizerOrgRow,
  type OrganizerReport,
} from '@/lib/organizer-groups'

const PAGE = 1000

async function selectAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export async function loadOrganizerReport(supabase: SupabaseClient): Promise<OrganizerReport> {
  const [events, aliases, orgs] = await Promise.all([
    // 下書き以外を全件（1000件を超えても取りこぼさないよう、並びを固定してページ送りする）
    selectAll<OrganizerEventRow>((from, to) =>
      supabase
        .from('events')
        .select('organizer_name_text, start_at, external_source')
        .neq('status', 'draft')
        .order('start_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    selectAll<OrganizerAliasRow>((from, to) =>
      supabase
        .from('organizer_aliases')
        .select('alias_key, canonical_name, org_id')
        .order('alias_key', { ascending: true })
        .range(from, to),
    ),
    selectAll<OrganizerOrgRow>((from, to) =>
      supabase.from('organizations').select('id, name').order('id', { ascending: true }).range(from, to),
    ),
  ])
  return buildOrganizerReport(events, aliases, orgs)
}

export type OrganizerDistinctRow = {
  key_a: string
  key_b: string
  label_a: string
  label_b: string
  decision_id: string
  created_at: string
}

/** 「別の団体です」と記録した組（似ている候補から外す・取り消し一覧に出す） */
export async function loadOrganizerDistinctPairs(supabase: SupabaseClient): Promise<OrganizerDistinctRow[]> {
  return selectAll<OrganizerDistinctRow>((from, to) =>
    supabase
      .from('organizer_distinct_pairs')
      .select('key_a, key_b, label_a, label_b, decision_id, created_at')
      .order('created_at', { ascending: false })
      .order('key_a', { ascending: true })
      .order('key_b', { ascending: true })
      .range(from, to),
  )
}
