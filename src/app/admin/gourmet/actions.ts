'use server'

// 食レポの SNS 巡回の候補の承認・却下（2026-11-13）。処理の中身は src/lib/gourmet-candidates.ts
import { revalidatePath } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { CandidateError, addShopAndApprove, approveShops, rejectCandidate, rejectShops, requestResearch } from '@/lib/gourmet-candidates'
import { GOURMET_CRAWL_SETTING } from '@/lib/gourmet-crawl'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('サーバー接続が未設定です')
  return { db: createServiceClient(url, key, { auth: { persistSession: false } }), userId: user.id }
}

type Result = { ok: true; message: string } | { ok: false; message: string }

function fail(e: unknown): Result {
  return { ok: false, message: e instanceof CandidateError || e instanceof Error ? e.message : '処理できませんでした' }
}

export async function approveSelected(id: string, picks: Array<{ index: number; ref: string }>): Promise<Result> {
  try {
    const { db, userId } = await requireAdmin()
    const n = await approveShops(db, id, picks, userId)
    revalidatePath('/admin/gourmet')
    return { ok: true, message: `${n} 件を地図に出しました（反映まで最大1分）` }
  } catch (e) { return fail(e) }
}

/** 地図にないお店を足して、そのまま承認する（位置は運営が確かめたもの） */
export async function addShopAndApproveAction(id: string, index: number, input: { name: string; address: string; lat: number; lon: number }): Promise<Result> {
  try {
    const { db, userId } = await requireAdmin()
    const r = await addShopAndApprove(db, id, index, input, userId)
    revalidatePath('/admin/gourmet')
    return { ok: true, message: r.reused ? '同じお店がもう地図にあったので、そのお店に付けて承認しました（反映まで最大1分）' : 'お店を地図に足して承認しました（反映まで最大1分）' }
  } catch (e) { return fail(e) }
}

/** 「住所を調べて自動登録」：調査依頼の印を付ける。調査・登録は自動処理が行う（Muse の夜の処理のあと） */
export async function requestAddressResearch(id: string, index: number): Promise<Result> {
  try {
    const { db } = await requireAdmin()
    await requestResearch(db, id, index)
    revalidatePath('/admin/gourmet')
    return { ok: true, message: '住所の調査を依頼しました。結果が出れば自動で地図に載ります（Muse が夜に調べるので、明日の朝までかかります）' }
  } catch (e) { return fail(e) }
}

export async function rejectSelected(id: string, indexes: number[]): Promise<Result> {
  try {
    const { db, userId } = await requireAdmin()
    await rejectShops(db, id, indexes, userId)
    revalidatePath('/admin/gourmet')
    return { ok: true, message: '選んだお店を却下しました' }
  } catch (e) { return fail(e) }
}

export async function rejectPost(id: string): Promise<Result> {
  try {
    const { db, userId } = await requireAdmin()
    await rejectCandidate(db, id, userId)
    revalidatePath('/admin/gourmet')
    return { ok: true, message: 'この投稿を却下しました' }
  } catch (e) { return fail(e) }
}

/** 緊急停止・再開（app_settings.gourmet_crawl.enabled） */
export async function setCrawlEnabled(enabled: boolean): Promise<Result> {
  try {
    const { db } = await requireAdmin()
    const { data } = await db.from('app_settings').select('value').eq('key', GOURMET_CRAWL_SETTING).maybeSingle()
    const value = { ...((data?.value as Record<string, unknown> | null) ?? {}), enabled }
    const { error } = await db.from('app_settings').upsert({ key: GOURMET_CRAWL_SETTING, value })
    if (error) throw new Error(error.message)
    revalidatePath('/admin/gourmet')
    return { ok: true, message: enabled ? '巡回を有効にしました（明朝の同期から）' : '巡回を止めました' }
  } catch (e) { return fail(e) }
}
