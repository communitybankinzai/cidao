// 食レポの SNS 巡回の候補を、運営が承認・却下する処理（2026-11-13）。管理画面 /admin/gourmet のボタンから呼ぶ。
// 承認したお店ごとに、同じ投稿の URL を gourmet_reports に入れる（(shop_ref, url) が一意なので同じ組は二重にならない）。
//   - 保留の理由（hold_reason）がある候補は承認できない（ちばモグ＝らいさんの確認待ち）
//   - 承認した食レポは source='crawl'・写真なし・ひとことなし・is_own=false。複数店の投稿には multi_shop の印
//   - お店を「変えて承認」できる（照合の候補か、食レポマップのお店の参照 osm:／poi:／shop: を直接）

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { GOURMET_MAP_URL } from '@/lib/cbi-site-urls'
import { MAX_ADDRESS, MAX_SHOP_NAME, gourmetAreaOf, insideChibaPrefecture, insideGourmetArea, normalizeText, parseShopRef, roundCoord } from '@/lib/gourmet'
import type { CandidateShop } from '@/lib/gourmet-crawl'

export type StoredShop = CandidateShop & { decision: 'approved' | 'rejected' | null; report_id: string | null }
export type CandidateRow = {
  id: string; source: string; post_id: string; post_url: string; author_handle: string | null; posted_at: string | null
  shops: StoredShop[]; more_shops: boolean; hold_reason: string; status: string; created_at: string
}

export class CandidateError extends Error {}

async function load(db: SupabaseClient, id: string): Promise<CandidateRow> {
  const { data, error } = await db.from('gourmet_candidates').select('id, source, post_id, post_url, author_handle, posted_at, shops, more_shops, hold_reason, status, created_at').eq('id', id).maybeSingle()
  if (error || !data) throw new CandidateError('候補が見つかりません')
  return data as CandidateRow
}

/** お店の参照から、名前と位置を引く（食レポマップの一覧 osm:／poi: と、市民が足したお店 shop:）。範囲外は null */
export async function resolveShop(db: SupabaseClient, refRaw: string): Promise<{ ref: string; name: string; lat: number; lon: number } | null> {
  const ref = parseShopRef(refRaw)
  if (!ref || ref.kind === 'ff') return null
  if (ref.kind === 'shop') {
    const { data } = await db.from('gourmet_shops').select('id, name, address, lat, lon, hidden').eq('id', ref.id).maybeSingle()
    // 運営が足したお店は千葉県内まで通す（2026-11-14）。市民の登録 API は従来どおり印西市＋周辺6市町だけ
    return data && !data.hidden && (gourmetAreaOf(data.lat, data.lon) || insideChibaPrefecture(data.lat, data.lon, data.address)) ? { ref: ref.ref, name: data.name, lat: data.lat, lon: data.lon } : null
  }
  const res = await fetch(`${GOURMET_MAP_URL}osm-shops.json`, { cache: 'no-store' })
  if (!res.ok) throw new CandidateError('お店の一覧を読めません')
  const shops = ((await res.json()) as { shops: Array<{ id: string; name: string; lat: number; lon: number }> }).shops
  const s = shops.find((x) => String(x.id).toLowerCase() === ref.ref)
  return s && gourmetAreaOf(s.lat, s.lon) ? { ref: ref.ref, name: s.name, lat: s.lat, lon: s.lon } : null
}

function finished(shops: StoredShop[]) {
  return shops.every((s) => s.decision !== null)
}

/** 選んだお店（index と参照）を承認して地図に出す。戻り値は登録した件数 */
export async function approveShops(db: SupabaseClient, id: string, picks: Array<{ index: number; ref: string }>, memberId: string | null, route: 'auto' | 'manual' = memberId ? 'manual' : 'auto'): Promise<number> {
  const c = await load(db, id)
  if (c.status !== 'pending') throw new CandidateError('この候補はもう処理済みです')
  if (c.hold_reason) throw new CandidateError(`承認できません：${c.hold_reason}`)
  const shops = c.shops.map((s) => ({ ...s }))
  let added = 0
  for (const p of picks) {
    const s = shops[p.index]
    if (!s || s.decision) continue
    const shop = await resolveShop(db, p.ref)
    if (!shop) throw new CandidateError(`お店が見つからないか、範囲の外です：${p.ref}`)
    const reportId = randomUUID()
    const { error } = await db.from('gourmet_reports').insert({
      id: reportId, shop_ref: shop.ref, shop_name: shop.name, lat: shop.lat, lon: shop.lon, url: c.post_url, platform: 'instagram',
      author_handle: c.author_handle, is_own: false, image_url: null, comment: null, device_id: 'crawl', ip_hash: '',
      hidden: false, sns_ok: false, source: 'crawl', multi_shop: c.shops.length > 1, candidate_id: c.id, approval_route: route,
    })
    if (error && error.code !== '23505') throw new CandidateError(`登録できません：${error.message}`)
    shops[p.index] = { ...s, chosen_ref: shop.ref, decision: 'approved', report_id: error ? null : reportId }
    if (!error) added++
  }
  const done = finished(shops)
  const { error } = await db.from('gourmet_candidates').update({
    shops, status: done ? 'done' : 'pending', decided_at: done ? new Date().toISOString() : null, decided_by: memberId,
  }).eq('id', id)
  if (error) throw new CandidateError(`候補を更新できません：${error.message}`)
  return added
}

const SAME_SHOP_M = 100 // 同じ名前でこの距離以内のお店がもうあれば、それを使う（二重登録を防ぐ。市民の登録 API と同じ）

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type NewShopInput = { name: unknown; address?: unknown; lat: unknown; lon: unknown }

/** 新しいお店の入力を確かめて整える。名前なし・長すぎ・範囲外はエラー（範囲＝印西市＋周辺6市町） */
export function checkNewShop(input: NewShopInput): { name: string; address: string | null; lat: number; lon: number } {
  const name = normalizeText(input.name, MAX_SHOP_NAME)
  if (!name) throw new CandidateError('お店の名前を入れてください（60字まで）')
  const address = normalizeText(input.address, MAX_ADDRESS)
  if (address === undefined) throw new CandidateError('住所は100字までで入れてください')
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(insideGourmetArea(lat, lon) || insideChibaPrefecture(lat, lon, address))) throw new CandidateError('位置が範囲の外です（千葉県内で、住所に「千葉県」を入れて指定してください）')
  return { name, address, lat: roundCoord(lat), lon: roundCoord(lon) }
}

/** 同じ名前で近い位置のお店（100m 以内）があればそれを返す */
export function findSameShop<T extends { name: string; lat: number; lon: number }>(shops: T[], name: string, lat: number, lon: number): T | undefined {
  return shops.find((s) => s.name === name && distanceM(s.lat, s.lon, lat, lon) <= SAME_SHOP_M)
}

/** 地図にないお店を運営が足して（位置は運営が確かめたもの）、そのまま承認する。同じ名前で100m 以内のお店があればそれに付ける。
 *  承認に失敗したら、いま作ったお店は消す（地図に孤立したお店を残さない） */
export async function addShopAndApprove(db: SupabaseClient, id: string, index: number, input: NewShopInput, memberId: string | null): Promise<{ added: number; ref: string; reused: boolean }> {
  const c = await load(db, id)
  if (c.status !== 'pending') throw new CandidateError('この候補はもう処理済みです')
  if (c.hold_reason) throw new CandidateError(`承認できません：${c.hold_reason}`)
  const s = c.shops[index]
  if (!s || s.decision) throw new CandidateError('このお店はもう処理済みです')
  const shop = checkNewShop(input)
  const { data: same, error: readErr } = await db.from('gourmet_shops').select('id, name, lat, lon').eq('name', shop.name).eq('hidden', false).limit(20)
  if (readErr) throw new CandidateError(`お店を調べられません：${readErr.message}`)
  const near = findSameShop((same ?? []) as Array<{ id: string; name: string; lat: number; lon: number }>, shop.name, shop.lat, shop.lon)
  let shopId: string
  let created = false
  if (near) shopId = near.id
  else {
    const { data: ins, error } = await db.from('gourmet_shops').insert({ name: shop.name, address: shop.address, lat: shop.lat, lon: shop.lon, device_id: 'admin', ip_hash: '' }).select('id').single()
    if (error || !ins) throw new CandidateError(`お店を登録できません：${error?.message ?? ''}`)
    shopId = ins.id as string
    created = true
  }
  const ref = `shop:${shopId}`
  try {
    const added = await approveShops(db, id, [{ index, ref }], memberId)
    return { added, ref, reused: !created }
  } catch (e) {
    if (created) await db.from('gourmet_shops').delete().eq('id', shopId)
    throw e
  }
}

/** お店ごとに却下する（残りのお店は承認できる） */
export async function rejectShops(db: SupabaseClient, id: string, indexes: number[], memberId: string | null): Promise<void> {
  const c = await load(db, id)
  if (c.status !== 'pending') throw new CandidateError('この候補はもう処理済みです')
  const shops = c.shops.map((s, i) => (indexes.includes(i) && !s.decision ? { ...s, decision: 'rejected' as const } : s))
  const done = finished(shops)
  const allRejected = done && shops.every((s) => s.decision === 'rejected')
  await db.from('gourmet_candidates').update({
    shops, status: done ? (allRejected ? 'rejected' : 'done') : 'pending', decided_at: done ? new Date().toISOString() : null, decided_by: memberId,
  }).eq('id', id)
}

/** 投稿ごと却下する */
export async function rejectCandidate(db: SupabaseClient, id: string, memberId: string | null): Promise<void> {
  const c = await load(db, id)
  if (c.status !== 'pending') throw new CandidateError('この候補はもう処理済みです')
  const shops = c.shops.map((s) => (s.decision ? s : { ...s, decision: 'rejected' as const }))
  await db.from('gourmet_candidates').update({ shops, status: 'rejected', decided_at: new Date().toISOString(), decided_by: memberId }).eq('id', id)
}
