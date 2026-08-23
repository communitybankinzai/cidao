'use server'

// 管理画面「災害タイムライン 情報源」の Server Actions。
// sns/actions.ts と同じく、エラーはすべて戻り値で返す（本番ビルドで throw がマスクされるため）。

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  isKnownKind,
  runDisasterTimeline,
  testFetchSource,
  type InfoSource,
  type SourceRunResult,
  type SourceTrust,
  type TimelineItemDraft,
} from '@/lib/disaster-timeline'

const PATH = '/admin/disaster-sources'
const TRUSTS: SourceTrust[] = ['official', 'semi-official', 'unverified']

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

export type SourceInput = {
  kind: string
  label: string
  url: string
  configJson: string
  trust: SourceTrust
  enabled: boolean
}

export type PreviewItem = {
  title: string
  occurredAt: string
  body: string
  url: string | null
}

export type ManualItemInput = {
  sourceId: string
  occurredAt: string // datetime-local の値（JST）
  title: string
  body: string
  url: string
  trust: SourceTrust
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  return { supabase, user }
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('災害タイムラインのサーバー接続が未設定です')
  return createSupabaseAdmin(url, key, { auth: { persistSession: false } })
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/relation .* does not exist|could not find the table|schema cache/i.test(message)) {
    return 'テーブルが未作成です。Supabase SQL Editor で migration 20260823120000_disaster_timeline.sql を実行してください。'
  }
  return message
}

function normalizeSource(input: SourceInput): Omit<InfoSource, 'id'> {
  const kind = input.kind.trim()
  if (!isKnownKind(kind)) throw new Error(`未対応の種別です: ${kind}`)
  const label = input.label.trim()
  if (!label || label.length > 100) throw new Error('表示名は1〜100文字で入力してください')
  const url = input.url.trim()
  if (url && !/^https?:\/\//.test(url)) throw new Error('URL は http(s):// から始めてください')
  if (!url && !['sns-priority', 'manual'].includes(kind)) throw new Error('この種別では URL が必須です')
  let config: Record<string, unknown> = {}
  const configText = input.configJson.trim()
  if (configText) {
    try {
      const parsed: unknown = JSON.parse(configText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('オブジェクト形式で入力してください')
      config = parsed as Record<string, unknown>
    } catch (error) {
      throw new Error(`config の JSON が不正です: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!TRUSTS.includes(input.trust)) throw new Error('信頼度の値が不正です')
  return { kind, label, url, config, trust: input.trust, enabled: Boolean(input.enabled) }
}

export async function createSource(input: SourceInput): Promise<ActionResult> {
  try {
    await requireAdmin()
    const source = normalizeSource(input)
    const admin = adminClient()
    const { data: last } = await admin
      .from('disaster_info_sources')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { error } = await admin.from('disaster_info_sources').insert({
      ...source,
      sort_order: (Number(last?.sort_order) || 0) + 10,
    })
    if (error) throw error
    revalidatePath(PATH)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  try {
    await requireAdmin()
    const { error } = await adminClient()
      .from('disaster_info_sources')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    revalidatePath(PATH)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function deleteSource(id: string): Promise<ActionResult> {
  try {
    await requireAdmin()
    const { error } = await adminClient().from('disaster_info_sources').delete().eq('id', id)
    if (error) throw error
    revalidatePath(PATH)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

function toPreview(drafts: TimelineItemDraft[]): PreviewItem[] {
  return drafts.slice(0, 10).map((draft) => ({
    title: draft.title,
    occurredAt: draft.occurredAt,
    body: draft.body.slice(0, 160),
    url: draft.url,
  }))
}

/** 保存済み情報源のテスト取得（DB には書かない） */
export async function testFetchSavedSource(id: string): Promise<ActionResult<{ total: number; items: PreviewItem[] }>> {
  try {
    await requireAdmin()
    const admin = adminClient()
    const { data, error } = await admin
      .from('disaster_info_sources')
      .select('id, kind, label, url, config, trust, enabled')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('情報源が見つかりません')
    const drafts = await testFetchSource(
      { ...data, config: (data.config ?? {}) as Record<string, unknown> } as InfoSource,
      { supabase: admin },
    )
    return { ok: true, data: { total: drafts.length, items: toPreview(drafts) } }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** 未保存の入力内容でテスト取得（DB には書かない） */
export async function testFetchDraftSource(input: SourceInput): Promise<ActionResult<{ total: number; items: PreviewItem[] }>> {
  try {
    await requireAdmin()
    const source = normalizeSource(input)
    const drafts = await testFetchSource({ ...source, id: 'preview' }, { supabase: adminClient() })
    return { ok: true, data: { total: drafts.length, items: toPreview(drafts) } }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** 「今すぐ巡回」。cron と同じ処理をクレームなしで実行する */
export async function runTimelineNow(): Promise<ActionResult<{ status: string; results: SourceRunResult[] }>> {
  try {
    await requireAdmin()
    const result = await runDisasterTimeline(adminClient(), { claim: false })
    revalidatePath(PATH)
    return { ok: true, data: { status: result.status ?? 'skipped', results: result.results } }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function createManualItem(input: ManualItemInput): Promise<ActionResult> {
  try {
    await requireAdmin()
    const admin = adminClient()
    const title = input.title.trim()
    if (!title || title.length > 200) throw new Error('タイトルは1〜200文字で入力してください')
    const body = input.body.trim()
    const url = input.url.trim()
    if (url && !/^https?:\/\//.test(url)) throw new Error('URL は http(s):// から始めてください')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.occurredAt)) throw new Error('発生日時を入力してください')
    const occurredAt = new Date(`${input.occurredAt.slice(0, 16)}:00+09:00`)
    if (Number.isNaN(occurredAt.getTime())) throw new Error('発生日時が不正です')
    if (!TRUSTS.includes(input.trust)) throw new Error('信頼度の値が不正です')

    const { data: source, error: sourceError } = await admin
      .from('disaster_info_sources')
      .select('id, kind')
      .eq('id', input.sourceId)
      .maybeSingle()
    if (sourceError) throw sourceError
    if (!source || source.kind !== 'manual') throw new Error('手動登録用（kind=manual）の情報源を選んでください')

    const { createHash } = await import('node:crypto')
    const now = new Date().toISOString()
    const { error } = await admin.from('disaster_timeline_items').insert({
      source_id: source.id,
      external_key: `manual:${now}:${Math.random().toString(36).slice(2, 8)}`,
      occurred_at: occurredAt.toISOString(),
      title,
      body,
      url: url || null,
      area_tag: '印西市',
      change_type: 'new',
      priority: 1,
      content_hash: createHash('sha256').update(`${title}${body}`, 'utf8').digest('hex'),
      raw: { trust: input.trust, enteredBy: 'admin' },
      fetched_at: now,
      first_seen_at: now,
      updated_at: now,
    })
    if (error) throw error
    revalidatePath(PATH)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}
