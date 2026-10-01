// Instagram 取り込み（ハッシュタグ／アカウント）の DB 口を Supabase（service_role）で実装する。
// 2 つの cron（instagram-events-sync・instagram-accounts-sync）で共用。

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { estimateCost, unavailableCost } from '@/lib/ai/pricing'
import { recordApiUsage } from '@/lib/talent-bank/usage'
import type { EventRow, OtherEventRow } from '@/lib/inzai-bunka/sync'
import { INSTAGRAM_HASHTAG_SOURCE } from './hashtag'
import { INSTAGRAM_ACCOUNT_SOURCE, parseInstagramUsername, type MonitorAccount } from './accounts'
import { INSTAGRAM_SCAN_PURPOSE, type IgAccountSyncDb } from './sync'

export const INSTAGRAM_SOURCES = [INSTAGRAM_HASHTAG_SOURCE, INSTAGRAM_ACCOUNT_SOURCE] as const

/** 今月1日 0:00 JST を UTC の ISO で */
export function monthStartJstIso(now = new Date()): string {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(now)
  return new Date(`${ym}-01T00:00:00+09:00`).toISOString()
}

/** 読み取り費用の今月累計と記録開始からの累計（円） */
export async function costSums(supabase: SupabaseClient): Promise<{ month: number; total: number }> {
  const { data, error } = await supabase.from('api_usage').select('est_cost_jpy, created_at').eq('purpose', INSTAGRAM_SCAN_PURPOSE).limit(10000)
  if (error) throw new Error(`costSums: ${error.message}`)
  const monthStart = monthStartJstIso()
  let month = 0
  let total = 0
  for (const r of (data ?? []) as { est_cost_jpy: number | null; created_at: string }[]) {
    const c = Number(r.est_cost_jpy) || 0
    total += c
    if (r.created_at >= monthStart) month += c
  }
  return { month, total }
}

type AccountRow = {
  id: string
  username: string
  label: string
  kind: MonitorAccount['kind']
  org_id: string | null
}

/** 団体の sns_links.instagram を sns_monitor_accounts に写す（無い行だけ追加。運営が付けた label／enabled は触らない） */
export async function syncOrgAccountsIntoList(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.from('organizations').select('id, name, sns_links').not('sns_links', 'is', null).limit(5000)
  if (error) throw new Error(`syncOrgAccountsIntoList: ${error.message}`)
  const rows: { platform: 'instagram'; username: string; label: string; kind: '団体'; org_id: string }[] = []
  const seen = new Set<string>()
  for (const o of (data ?? []) as { id: string; name: string; sns_links: Record<string, unknown> | null }[]) {
    const raw = o.sns_links && typeof o.sns_links === 'object' ? o.sns_links.instagram : null
    const username = typeof raw === 'string' ? parseInstagramUsername(raw) : null
    if (!username || seen.has(username.toLowerCase())) continue
    seen.add(username.toLowerCase())
    rows.push({ platform: 'instagram', username, label: o.name, kind: '団体', org_id: o.id })
  }
  if (rows.length === 0) return 0
  const { error: upErr } = await supabase.from('sns_monitor_accounts').upsert(rows, { onConflict: 'platform,username', ignoreDuplicates: true })
  if (upErr) throw new Error(`syncOrgAccountsIntoList upsert: ${upErr.message}`)
  return rows.length
}

export function makeIgSyncDb(supabase: SupabaseClient, botMemberId: string): IgAccountSyncDb {
  return {
    async loadDiscoveryAuth() {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'sns_instagram_discovery_auth').maybeSingle()
      if (error) throw new Error(`loadDiscoveryAuth: ${error.message}`)
      const v = (data?.value ?? null) as { user_id?: string; access_token?: string } | null
      return v?.user_id && v?.access_token ? { user_id: String(v.user_id), access_token: String(v.access_token) } : null
    },
    async listExistingSourceIds() {
      const { data, error } = await supabase.from('events').select('external_source_id').in('external_source', [...INSTAGRAM_SOURCES]).limit(5000)
      if (error) throw new Error(`listExistingSourceIds: ${error.message}`)
      return ((data ?? []) as { external_source_id: string }[]).map((r) => r.external_source_id).filter(Boolean)
    },
    async listRecentlyScannedIds() {
      const { data, error } = await supabase
        .from('event_sync_runs')
        .select('detail')
        .in('source', [...INSTAGRAM_SOURCES])
        .eq('dry_run', false) // 確認だけの実行（?dry=1）で読んだ投稿は、本実行で読み直す
        .order('started_at', { ascending: false })
        .limit(14)
      if (error) throw new Error(`listRecentlyScannedIds: ${error.message}`)
      const ids: string[] = []
      for (const r of (data ?? []) as { detail: { scanned?: unknown } | null }[]) {
        const scanned = r.detail?.scanned
        if (Array.isArray(scanned)) for (const id of scanned) if (typeof id === 'string') ids.push(id)
      }
      return ids
    },
    async listFutureEvents(fromDate: string) {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_at, location, organizer_name_text')
        .gte('start_at', `${fromDate}T00:00:00+09:00`)
        .limit(3000)
      if (error) throw new Error(`listFutureEvents: ${error.message}`)
      return (data ?? []) as OtherEventRow[]
    },
    async hasEventWithSourceId(sourceId: string) {
      const { data, error } = await supabase.from('events').select('id').eq('external_source_id', sourceId).limit(1)
      if (error) throw new Error(`hasEventWithSourceId: ${error.message}`)
      return (data ?? []).length > 0
    },
    async monthCostJpy() {
      return (await costSums(supabase)).month
    },
    async insert(row: EventRow) {
      const { error } = await supabase.from('events').insert(row)
      if (error) throw new Error(`insert: ${error.message}`)
    },
    async recordUsage({ model, usage, error }) {
      try {
        const cost = usage ? await estimateCost({ model, usage }) : unavailableCost()
        await recordApiUsage({
          run_id: randomUUID(), case_id: null, subject_id: null, member_id: botMemberId,
          provider: 'anthropic', model, purpose: INSTAGRAM_SCAN_PURPOSE,
          input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
          cache_creation_tokens: usage?.cache_creation_tokens ?? null, cache_read_tokens: usage?.cache_read_tokens ?? null,
          ...cost, error,
        })
        return cost.est_cost_jpy
      } catch {
        console.error('[instagram-events] usage recording failed')
        return null
      }
    },
    async listMonitorAccounts() {
      await syncOrgAccountsIntoList(supabase)
      const { data, error } = await supabase
        .from('sns_monitor_accounts')
        .select('id, username, label, kind, org_id')
        .eq('platform', 'instagram')
        .eq('enabled', true)
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) throw new Error(`listMonitorAccounts: ${error.message}`)
      return ((data ?? []) as AccountRow[]).map((a) => ({ id: a.id, username: a.username, label: a.label, kind: a.kind, orgId: a.org_id }))
    },
    async updateAccountStatus(id, patch) {
      const { error } = await supabase.from('sns_monitor_accounts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(`updateAccountStatus: ${error.message}`)
    },
  }
}
