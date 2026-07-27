'use server'

// 管理画面「チラシ一括取り込み」の登録処理。
//
// COCoLa の Google Apps Script（Drive フォルダ監視 → Gemini Vision → /api/events/ingest）を
// CBI 側で完結させるための置き換え。抽出は既存の /api/events/scan（Claude）を再利用し、
// ここでは「管理者が確認した結果を events に入れる」ところだけを担う。
//
// 重複排除: external_source='cbi-admin-import' × external_source_id=画像のSHA-256。
// 同じチラシを再アップロードしても二重登録にならない（GAS が Drive fileId で行っていたのと同じ役割）。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { jstLocalToUtcIso } from '@/lib/datetime'

const EXTERNAL_SOURCE = 'cbi-admin-import'

export type ImportItem = {
  image_sha256: string
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
}

export type ImportResult = {
  image_sha256: string
  status: 'created' | 'duplicated' | 'failed'
  event_id?: string
  message?: string
}

// 1件分を events に挿入する。既に同じ画像から作られたイベントがあれば作らない。
async function importOne(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  item: ImportItem,
): Promise<ImportResult> {
  const { image_sha256 } = item

  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('external_source', EXTERNAL_SOURCE)
    .eq('external_source_id', image_sha256)
    .maybeSingle()
  if (existing) {
    return { image_sha256, status: 'duplicated', event_id: existing.id }
  }

  const title = item.title.trim().slice(0, 80)
  if (!title) return { image_sha256, status: 'failed', message: 'タイトルが空です' }

  // jstLocalToUtcIso はパースできない文字列をそのまま返すため、先に形式を検証する
  const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
  if (!LOCAL_DT.test(item.start_at) || !LOCAL_DT.test(item.end_at)) {
    return { image_sha256, status: 'failed', message: '日時は YYYY-MM-DDTHH:MM 形式で入力してください' }
  }
  const startIso = jstLocalToUtcIso(item.start_at)
  const endIso = jstLocalToUtcIso(item.end_at)
  if (new Date(endIso) < new Date(startIso)) {
    return { image_sha256, status: 'failed', message: '終了日時が開始日時より前です' }
  }

  // 管理者は主催者本人ではないため、既存の代理登録と同じ扱いにする。
  // proxy_registration=true のとき proxy_source_url が必須（DB の CHECK 制約）。
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
      proxy_source_url: item.flyer_image_url ?? 'https://cidao.vercel.app/admin/events/import',
      flyer_image_url: item.flyer_image_url ?? null,
      external_source: EXTERNAL_SOURCE,
      external_source_id: image_sha256,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { image_sha256, status: 'failed', message: error.message }
  return { image_sha256, status: 'created', event_id: data.id }
}

export async function importScannedEvents(items: ImportItem[]): Promise<ImportResult[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) throw new Error('権限がありません')

  if (!Array.isArray(items) || items.length === 0) return []
  if (items.length > 30) throw new Error('一度に登録できるのは30件までです')

  const results: ImportResult[] = []
  for (const item of items) {
    try {
      results.push(await importOne(supabase, user.id, item))
    } catch (e) {
      results.push({
        image_sha256: item.image_sha256,
        status: 'failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  revalidatePath('/events')
  revalidatePath('/admin/events')
  return results
}
