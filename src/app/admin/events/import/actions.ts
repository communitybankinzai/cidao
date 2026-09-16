'use server'

// 管理画面「一括取り込み」の登録処理。取り込み元は2種類ある。
//
//   flyer  : チラシ画像を1枚ずつ AI 抽出（/api/events/scan）→ external_source='cbi-admin-import'
//   kouhou : 広報いんざいの PDF をまとめて AI 抽出（/api/events/scan-pdf）→ external_source='cbi-kouhou-import'
//
// COCoLa の Google Apps Script（Drive フォルダ監視 → Gemini Vision → /api/events/ingest）を
// CBI 側で完結させるための置き換え。ここでは「管理者が確認した結果を events に入れる」ところだけを担う。
//
// 重複排除: external_source × external_source_id（dedupe_key）。
//   flyer  は画像の SHA-256、kouhou は `kouhou_2609#3` のような 紙面ID＋連番。
//   同じチラシ・同じ号を再取り込みしても二重登録にならない（GAS が Drive fileId で行っていたのと同じ役割）。

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { jstLocalToUtcIso } from '@/lib/datetime'

// 取り込み元ごとの external_source。クライアントから任意の値を入れられないよう列挙で固定する。
const EXTERNAL_SOURCES = {
  flyer: 'cbi-admin-import',
  kouhou: 'cbi-kouhou-import',
} as const

export type ImportSource = keyof typeof EXTERNAL_SOURCES

// 1回の登録で扱える上限。広報いんざい1号あたりのイベント候補が約70件あるため、
// チラシ時代の30件では足りない（実測: 令和8年9月号は日時付き記事が77件）。
const MAX_ITEMS = 100

export type ImportItem = {
  dedupe_key: string        // flyer: 画像のSHA-256 / kouhou: `kouhou_2609#3`
  source: ImportSource
  title: string
  description: string
  category: string
  start_at: string          // YYYY-MM-DDTHH:MM（JST ローカル）
  end_at: string            // 同上
  location?: string | null
  online_flag: boolean
  capacity?: number | null
  fee?: number | null
  organizer_name?: string | null
  flyer_image_url?: string | null
  source_url?: string | null // 出典URL（広報いんざいの掲載ページ等）。代理登録の根拠として残す
}

export type ImportResult = {
  dedupe_key: string
  status: 'created' | 'duplicated' | 'failed'
  event_id?: string
  message?: string
}

// 1件分を events に挿入する。既に同じ取り込み元・同じキーで作られたイベントがあれば作らない。
async function importOne(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  item: ImportItem,
): Promise<ImportResult> {
  const { dedupe_key } = item
  const externalSource = EXTERNAL_SOURCES[item.source]
  if (!externalSource) {
    return { dedupe_key, status: 'failed', message: '取り込み元の指定が不正です' }
  }

  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('external_source', externalSource)
    .eq('external_source_id', dedupe_key)
    .maybeSingle()
  if (existing) {
    return { dedupe_key, status: 'duplicated', event_id: existing.id }
  }

  const title = item.title.trim().slice(0, 80)
  if (!title) return { dedupe_key, status: 'failed', message: 'タイトルが空です' }

  // jstLocalToUtcIso はパースできない文字列をそのまま返すため、先に形式を検証する
  const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
  if (!LOCAL_DT.test(item.start_at) || !LOCAL_DT.test(item.end_at)) {
    return { dedupe_key, status: 'failed', message: '日時は YYYY-MM-DDTHH:MM 形式で入力してください' }
  }
  const startIso = jstLocalToUtcIso(item.start_at)
  const endIso = jstLocalToUtcIso(item.end_at)
  if (new Date(endIso) < new Date(startIso)) {
    return { dedupe_key, status: 'failed', message: '終了日時が開始日時より前です' }
  }

  // 管理者は主催者本人ではないため、既存の代理登録と同じ扱いにする。
  // proxy_registration=true のとき proxy_source_url が必須（DB の CHECK 制約）。
  const fallbackSourceUrl = 'https://cidao.vercel.app/admin/events/import'
  const { data, error } = await supabase
    .from('events')
    .insert({
      title,
      description: item.description?.trim() || title,
      category: item.category || 'other',
      start_at: startIso,
      end_at: endIso,
      location: item.location?.trim() || null,
      online_flag: item.online_flag,
      capacity: item.capacity ?? null,
      fee: item.fee ?? null,
      organizer_type: 'member',
      organizer_id: userId,
      organizer_name_text: item.organizer_name?.trim() || '主催者不明',
      proxy_registration: true,
      proxy_source_url: item.source_url ?? item.flyer_image_url ?? fallbackSourceUrl,
      flyer_image_url: item.flyer_image_url ?? null,
      external_source: externalSource,
      external_source_id: dedupe_key,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { dedupe_key, status: 'failed', message: error.message }
  return { dedupe_key, status: 'created', event_id: data.id }
}

export async function importScannedEvents(items: ImportItem[]): Promise<ImportResult[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) throw new Error('権限がありません')

  if (!Array.isArray(items) || items.length === 0) return []
  if (items.length > MAX_ITEMS) throw new Error(`一度に登録できるのは${MAX_ITEMS}件までです`)

  const results: ImportResult[] = []
  for (const item of items) {
    try {
      results.push(await importOne(supabase, user.id, item))
    } catch (e) {
      results.push({
        dedupe_key: item.dedupe_key,
        status: 'failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  revalidatePath('/events')
  revalidatePath('/admin/events')
  return results
}

// ---------------------------------------------------------------------------
// 号外NET から拾ったコスモスパレットの催し候補（external_source='goguynet-cosmos'・status='draft'）
// 下書きは RLS 上、作った bot 以外には見えないので、運営確認のうえ service_role で読み書きする。
// ---------------------------------------------------------------------------

const COSMOS_SOURCE = 'goguynet-cosmos'

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('service role が設定されていません')
  return createSupabaseAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function requireAdmin(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin, error } = await supabase.rpc('is_admin')
  if (error || !isAdmin) throw new Error('権限がありません')
  return user.id
}

export type CosmosCandidateRow = {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string | null
  fee: number | null
  description: string
  proxy_source_url: string | null
  created_at: string
}

/** 確認待ちの候補（今日以降・開催日順） */
export async function listCosmosCandidates(): Promise<CosmosCandidateRow[]> {
  await requireAdmin()
  const { data, error } = await serviceClient()
    .from('events')
    .select('id, title, start_at, end_at, location, fee, description, proxy_source_url, created_at')
    .eq('external_source', COSMOS_SOURCE)
    .eq('status', 'draft')
    .gte('start_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order('start_at', { ascending: true })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as CosmosCandidateRow[]
}

async function setCosmosCandidateStatus(id: string, status: 'open' | 'cancelled'): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin()
    const service = serviceClient()
    const { data, error } = await service
      .from('events')
      .update({ status })
      .eq('id', id)
      .eq('external_source', COSMOS_SOURCE)
      .eq('status', 'draft')
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!data || data.length === 0) return { ok: false, error: 'この候補はすでに処理済みです（画面を更新してください）' }
    revalidatePath('/events')
    revalidatePath('/admin/events')
    revalidatePath('/admin/events/import')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 候補を公開イベントにする */
export async function publishCosmosCandidate(id: string) {
  return setCosmosCandidateStatus(id, 'open')
}

/** 候補を見送る（cancelled のまま残すので、翌日以降の同期で再び候補にならない） */
export async function dismissCosmosCandidate(id: string) {
  return setCosmosCandidateStatus(id, 'cancelled')
}
