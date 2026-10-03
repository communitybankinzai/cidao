'use server'

// 管理画面「OpenPOIインポート管理」の Server Actions。
//
// 方針
//  ・エラーは例外にせず戻り値で返す（本番ビルドでは throw のメッセージがマスクされるため）
//  ・取得は「候補」への保存まで。FreeFree投稿の公開は別操作（運営が選んだ候補だけ）
//  ・Dry Run は DB に一切書かない
//  ・既存の freefree_posts は変更・削除しない（新規 INSERT のみ）
//  ・RLS: 候補・履歴テーブルは is_committee_or_super() のみ。公開は運営本人のセッションで INSERT する

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { endOfDayJstIso, isValidEndDate, maxEndDate } from '@/lib/freefree-dates'
import { recordWrite } from '@/lib/audit'
import { announceFreefreeToSns } from '@/lib/sns-announce'
import { jstToday } from '@/lib/freefree-dates'
import { resolveCityBbox, searchBbox } from '@/lib/openpoi'
import { geocodeAddress, isNearInzai } from '@/lib/geocode'
import {
  DedupIndex,
  REGIONS,
  areaFromAddress,
  buildIntroPrompt,
  findRiskyPhrases,
  normalizeDisplayText,
  normalizeInstagramUrl,
  INSTAGRAM_LINK_LABEL,
  openpoiCategoryLabel,
  sanitizeIntro,
  bboxFromCenter,
  bboxWithinLimit,
  buildPostDraft,
  makeManualSourceId,
  remainingDailyCap,
  SNS_DAILY_CAP_DEFAULT,
  checkPublishable,
  collectByBbox,
  inTargetCity,
  isValidBbox,
  postToDedupRecord,
  regionKeyFor,
  toCandidateDraft,
  type Bbox,
  type CandidateDraft,
  type CandidateEdits,
  type DedupRecord,
  type DedupResult,
} from '@/lib/freefree-import-core'

const PATH = '/admin/freefree/openpoi'
const FETCH_DEADLINE_MS = 40_000
const MIN_FETCH_INTERVAL_MS = 15_000
const DRY_RUN_INTERVAL_MS = 8_000
const PUBLISH_CHUNK_MAX = 50

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

type Supabase = Awaited<ReturnType<typeof createClient>>

async function requireAdmin(): Promise<{ supabase: Supabase; userId: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  // 既存の「FreeFree掲示板の管理」と同じ基準（committee / super）。RLS 側も同じ関数で守っている
  const { data: me } = await supabase.from('members').select('admin_role').eq('id', user.id).maybeSingle()
  const role = me?.admin_role as string | null | undefined
  if (role !== 'committee' && role !== 'super') throw new Error('権限がありません')
  return { supabase, userId: user.id }
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/relation .*freefree_import|could not find the table|schema cache/i.test(m)) {
    return 'テーブルが未作成です。supabase/migrations/20261002100000_freefree_openpoi_import.sql を適用してください。'
  }
  return m
}

// ---------------------------------------------------------------------------
// 取得（Dry Run / 候補保存）
// ---------------------------------------------------------------------------

export type FetchInput = {
  dryRun: boolean
  region:
    | { mode: 'city'; prefecture: string; city: string }
    | { mode: 'bbox'; bbox: number[] }
    | { mode: 'center'; lat: number; lng: number; radiusM: number }
}

export type FetchSummary = {
  dryRun: boolean
  regionKey: string
  bbox: Bbox
  requests: number
  fetched: number          // API から受け取った件数（重複除去後）
  outOfCity: number        // 対象市区町村ではないため除外
  invalid: number          // 名称・座標なしで取り込めない
  alreadyKnown: number     // すでに候補にある（変更なし）
  refreshed: number        // すでに候補にあり、内容を更新した
  updateFlagged: number    // 登録済み/編集済みでOpenPOI側に更新あり（上書きせず印のみ）
  newCandidates: number    // 新規に候補になる（= 登録予定の候補件数）
  newDuplicate: number
  newPossible: number
  newNone: number
  newUncategorized: number // カテゴリー判定不能（管理者確認対象）
  truncatedCells: number
  aborted: boolean
  abortReason: string | null
  failedWrites: number
  samples: { name: string; address: string | null; category: string | null; duplicate: string }[]
}

const lastDry = new Map<string, number>() // best-effort（サーバーレスではインスタンスごと）

async function loadAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

type ExistingCandidate = {
  id: string
  source_id: string
  import_status: string
  content_hash: string | null
  duplicate_status: string
  duplicate_reason: string | null
  edited: boolean
  edits: CandidateEdits | null
  name: string
  address: string | null
  prefecture: string | null
  city: string | null
  openpoi_category: string | null
  business_type: string | null
  licenses: string[]
  attributions: string[]
}

const DIFF_FIELDS = ['name', 'address', 'prefecture', 'city', 'openpoi_category', 'business_type'] as const

export async function runOpenpoiFetch(input: FetchInput): Promise<ActionResult<FetchSummary>> {
  let runId: string | null = null
  let supabase: Supabase | null = null
  try {
    const admin = await requireAdmin()
    supabase = admin.supabase
    const userId = admin.userId

    // ---- 範囲の決定 ----
    let bbox: Bbox
    let city: string | null = null
    let regionKey: string
    if (input.region.mode === 'city') {
      const prefecture = input.region.prefecture.trim()
      city = input.region.city.trim()
      if (!city) return { ok: false, error: '市区町村を入力してください' }
      const preset = REGIONS.find((r) => r.prefecture === prefecture && r.city === city)
      bbox = preset ? preset.bbox : await resolveCityBbox(prefecture, city)
      regionKey = regionKeyFor(prefecture, city)
    } else if (input.region.mode === 'bbox') {
      if (!isValidBbox(input.region.bbox)) return { ok: false, error: '範囲（西経度,南緯度,東経度,北緯度）が正しくありません' }
      bbox = input.region.bbox as Bbox
      regionKey = `bbox:${bbox.map((n) => n.toFixed(3)).join(',')}`
    } else {
      const { lat, lng, radiusM } = input.region
      if (![lat, lng, radiusM].every(Number.isFinite) || radiusM <= 0 || radiusM > 20_000 || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return { ok: false, error: '緯度・経度・半径（1〜20000m）を正しく入力してください' }
      }
      bbox = bboxFromCenter(lat, lng, radiusM)
      regionKey = `center:${lat.toFixed(4)},${lng.toFixed(4)},${Math.round(radiusM)}`
    }
    if (!bboxWithinLimit(bbox)) return { ok: false, error: '範囲が広すぎます（経度0.6°・緯度0.5°以内）。市区町村単位で取得してください' }

    // ---- 連打・多重起動の防止 ----
    if (input.dryRun) {
      const last = lastDry.get(userId) ?? 0
      if (Date.now() - last < DRY_RUN_INTERVAL_MS) return { ok: false, error: '連続で実行できません。少し待ってからもう一度お試しください' }
      lastDry.set(userId, Date.now())
    } else {
      const since = new Date(Date.now() - 3 * 60_000).toISOString()
      const { data: recent, error } = await supabase
        .from('freefree_import_runs')
        .select('id, status, started_at')
        .eq('kind', 'fetch')
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(error.message)
      const r = recent?.[0]
      if (r && (r.status === 'running' || Date.now() - new Date(r.started_at).getTime() < MIN_FETCH_INTERVAL_MS)) {
        return { ok: false, error: '直前に取得が実行されています。完了してからもう一度お試しください' }
      }
      const ins = await supabase
        .from('freefree_import_runs')
        .insert({ actor_id: userId, kind: 'fetch', region_key: regionKey, params: { region: input.region, bbox } })
        .select('id')
        .single()
      if (ins.error) throw new Error(ins.error.message)
      runId = ins.data.id
    }

    // ---- OpenPOI から取得（bbox を分割して全件を集める）----
    const collected = await collectByBbox(searchBbox, bbox, { deadlineAt: Date.now() + FETCH_DEADLINE_MS })

    let outOfCity = 0
    let invalid = 0
    const drafts = new Map<string, CandidateDraft>()
    for (const f of collected.facilities) {
      if (city && !inTargetCity(f, city)) { outOfCity++; continue }
      const d = toCandidateDraft(f)
      if (!d) { invalid++; continue }
      if (!drafts.has(d.source_id)) drafts.set(d.source_id, d)
    }
    const list = [...drafts.values()]

    // ---- 既存データの読み込み（重複判定・再取得の突き合わせ）----
    const existingBySid = new Map<string, ExistingCandidate>()
    const sids = list.map((d) => d.source_id)
    for (let i = 0; i < sids.length; i += 150) {
      const { data, error } = await supabase
        .from('freefree_import_candidates')
        .select('id, source_id, import_status, content_hash, duplicate_status, duplicate_reason, edited, edits, name, address, prefecture, city, openpoi_category, business_type, licenses, attributions')
        .eq('source', 'openpoi')
        .in('source_id', sids.slice(i, i + 150))
      if (error) throw new Error(error.message)
      for (const r of (data ?? []) as ExistingCandidate[]) existingBySid.set(r.source_id, r)
    }

    const dedupRecords: DedupRecord[] = []
    const cands = await loadAll<{ id: string; name: string; address: string | null; latitude: number | null; longitude: number | null; phone: string | null; website: string | null }>(
      (from, to) => supabase!.from('freefree_import_candidates').select('id, name, address, latitude, longitude, phone, website').neq('import_status', 'excluded').order('id').range(from, to),
    )
    for (const c of cands) dedupRecords.push({ kind: 'candidate', id: c.id, name: c.name, address: c.address, lat: c.latitude, lon: c.longitude, phone: c.phone, website: c.website })
    const posts = await loadAll<{ id: string; title: string; body: string | null; address: string | null; location: string | null; lat: number | null; lon: number | null; links: { url?: string }[] | null }>(
      (from, to) => supabase!.from('freefree_posts').select('id, title, body, address, location, lat, lon, links').neq('status', 'removed').order('id').range(from, to),
    )
    for (const p of posts) dedupRecords.push(postToDedupRecord(p))
    const index = new DedupIndex(dedupRecords)

    // ---- 判定 ----
    const s: FetchSummary = {
      dryRun: input.dryRun, regionKey, bbox, requests: collected.requests, fetched: collected.facilities.length,
      outOfCity, invalid, alreadyKnown: 0, refreshed: 0, updateFlagged: 0, newCandidates: 0, newDuplicate: 0, newPossible: 0,
      newNone: 0, newUncategorized: 0, truncatedCells: collected.truncatedCells, aborted: collected.aborted,
      abortReason: collected.abortReason, failedWrites: 0, samples: [],
    }

    const inserts: Record<string, unknown>[] = []
    const refreshes: { id: string; patch: Record<string, unknown> }[] = []
    const unchangedIds: string[] = []
    const now = new Date().toISOString()

    for (const d of list) {
      const ex = existingBySid.get(d.source_id)
      if (ex) {
        const changed = ex.content_hash !== d.content_hash
        const refreshable = (ex.import_status === 'candidate' || ex.import_status === 'failed') && !ex.edited
        if (!changed) {
          s.alreadyKnown++
          unchangedIds.push(ex.id)
          if (ex.import_status === 'candidate' || ex.import_status === 'failed') {
            // 新しい FreeFree 投稿が増えている可能性があるので、重複判定だけ更新し直す
            const dup = index.judge({ selfId: ex.id, name: ex.name, address: ex.address, lat: d.latitude, lon: d.longitude })
            if (dup.status !== ex.duplicate_status || dup.reason !== ex.duplicate_reason) refreshes.push({ id: ex.id, patch: dupFields(dup) })
          }
        } else if (refreshable) {
          const dup = index.judge({ selfId: ex.id, name: d.name, address: d.address, lat: d.latitude, lon: d.longitude })
          s.refreshed++
          refreshes.push({ id: ex.id, patch: { ...originFields(d), ...dupFields(dup), last_seen_at: now, update_available: false, update_diff: null } })
        } else {
          // 登録済み・編集済み・除外などは上書きしない。差分の印だけ付ける
          const fields: Record<string, { from: unknown; to: unknown }> = {}
          for (const k of DIFF_FIELDS) if ((ex[k] ?? null) !== (d[k] ?? null)) fields[k] = { from: ex[k] ?? null, to: d[k] ?? null }
          s.updateFlagged++
          refreshes.push({ id: ex.id, patch: { last_seen_at: now, update_available: true, update_detected_at: now, update_diff: { fields, licenses: d.licenses, attributions: d.attributions, raw: d.raw_data } } })
        }
        continue
      }
      const dup = index.judge({ name: d.name, address: d.address, lat: d.latitude, lon: d.longitude })
      s.newCandidates++
      if (dup.status === 'duplicate') s.newDuplicate++
      else if (dup.status === 'possible') s.newPossible++
      else s.newNone++
      if (!d.category) s.newUncategorized++
      if (s.samples.length < 12) s.samples.push({ name: d.name, address: d.address, category: d.category, duplicate: dup.status === 'none' ? '—' : `${dup.status === 'duplicate' ? '重複' : '重複の可能性'}（${dup.reason}）` })
      // 同じ取得の中の後続候補とも突き合わせるため、仮IDで索引に加える
      index.add({ kind: 'candidate', id: `new:${d.source_id}`, name: d.name, address: d.address, lat: d.latitude, lon: d.longitude })
      inserts.push({ ...originFields(d), ...dupFields(dup), source: 'openpoi', source_id: d.source_id, region_key: regionKey, import_status: 'candidate', last_seen_at: now })
    }

    if (input.dryRun) return { ok: true, data: s }

    // ---- 書き込み（候補のみ）----
    for (let i = 0; i < inserts.length; i += 100) {
      const { error } = await supabase.from('freefree_import_candidates').upsert(inserts.slice(i, i + 100), { onConflict: 'source,source_id', ignoreDuplicates: true })
      if (error) { s.failedWrites += Math.min(100, inserts.length - i); console.error('[openpoi-import] insert failed:', error.message) }
    }
    for (let i = 0; i < unchangedIds.length; i += 150) {
      const { error } = await supabase.from('freefree_import_candidates').update({ last_seen_at: now }).in('id', unchangedIds.slice(i, i + 150))
      if (error) { s.failedWrites += Math.min(150, unchangedIds.length - i); console.error('[openpoi-import] touch failed:', error.message) }
    }
    for (const r of refreshes) {
      const { error } = await supabase.from('freefree_import_candidates').update(r.patch).eq('id', r.id)
      if (error) { s.failedWrites++; console.error('[openpoi-import] update failed:', error.message) }
    }

    const status = s.failedWrites > 0 ? 'partial' : s.aborted || s.truncatedCells > 0 ? 'partial' : 'success'
    await supabase.from('freefree_import_runs').update({
      status, counts: s, finished_at: new Date().toISOString(),
      error: s.aborted ? s.abortReason : s.failedWrites > 0 ? `${s.failedWrites}件の書き込みに失敗` : null,
    }).eq('id', runId!)
    await recordWrite({ actorId: userId, action: 'freefree.import', targetType: 'freefree_import', targetId: runId, isAdmin: true, detail: { kind: 'fetch', regionKey, new: s.newCandidates, refreshed: s.refreshed } })
    revalidatePath(PATH)
    return { ok: true, data: s }
  } catch (e) {
    const msg = errMsg(e)
    if (runId && supabase) {
      await supabase.from('freefree_import_runs').update({ status: 'failed', error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', runId)
    }
    return { ok: false, error: msg }
  }
}

function originFields(d: CandidateDraft) {
  return {
    name: d.name, name_kana: d.name_kana, prefecture: d.prefecture, city: d.city, address: d.address,
    latitude: d.latitude, longitude: d.longitude, geocode_level: d.geocode_level,
    openpoi_category: d.openpoi_category, business_type: d.business_type, openpoi_source: d.openpoi_source,
    licenses: d.licenses, attributions: d.attributions, raw_data: d.raw_data, content_hash: d.content_hash,
    category: d.category, category_reason: d.category_reason,
  }
}

function dupFields(r: DedupResult) {
  return {
    duplicate_status: r.status,
    duplicate_reason: r.reason,
    duplicate_of_post_id: r.matchKind === 'post' ? r.matchId : null,
    duplicate_of_candidate_id: r.matchKind === 'candidate' && r.matchId && !r.matchId.startsWith('new:') ? r.matchId : null,
  }
}

// ---------------------------------------------------------------------------
// 候補の編集・除外
// ---------------------------------------------------------------------------

const EDIT_LIMITS: Record<keyof CandidateEdits, number> = {
  title: 40, body: 1000, category: 30, address: 200, phone: 40, website: 300, opening_hours: 300, description: 500, instagram: 200,
}

export async function saveCandidateEdits(id: string, edits: CandidateEdits): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin()
    const clean: CandidateEdits = {}
    for (const k of Object.keys(EDIT_LIMITS) as (keyof CandidateEdits)[]) {
      const v = edits[k]
      if (typeof v !== 'string') continue
      if (v.length > EDIT_LIMITS[k]) return { ok: false, error: `${k} が長すぎます` }
      clean[k] = v.trim()
    }
    if (clean.instagram) {
      const ig = normalizeInstagramUrl(clean.instagram)
      if (!ig) return { ok: false, error: 'Instagram はアカウント名か、アカウントの URL を入れてください（投稿の URL は使えません）' }
      clean.instagram = ig
    }
    if (clean.website && !/^https?:\/\//i.test(clean.website)) return { ok: false, error: 'WebサイトのURLは http:// か https:// で始めてください' }
    const { data: row, error: readErr } = await supabase.from('freefree_import_candidates').select('import_status').eq('id', id).maybeSingle()
    if (readErr) throw new Error(readErr.message)
    if (!row) return { ok: false, error: '候補が見つかりません' }
    if (row.import_status === 'imported' || row.import_status === 'publishing') return { ok: false, error: '登録済みの候補は編集できません（FreeFree側で編集してください）' }
    const edited = Object.values(clean).some((v) => v !== '')
    const { error } = await supabase.from('freefree_import_candidates')
      .update({ edits: Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== '')), edited })
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath(PATH)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export async function setCandidatesExcluded(ids: string[], excluded: boolean): Promise<ActionResult<{ changed: number }>> {
  try {
    const { supabase } = await requireAdmin()
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return { ok: false, error: '対象は1〜500件で指定してください' }
    // 登録済み・登録処理中には触れない
    const q = supabase.from('freefree_import_candidates')
    const { data, error } = excluded
      ? await q.update({ import_status: 'excluded' }).in('id', ids).in('import_status', ['candidate', 'failed']).select('id')
      : await q.update({ import_status: 'candidate', import_error: null }).in('id', ids).eq('import_status', 'excluded').select('id')
    if (error) throw new Error(error.message)
    revalidatePath(PATH)
    return { ok: true, data: { changed: data?.length ?? 0 } }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export async function dismissCandidateUpdate(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireAdmin()
    const { error } = await supabase.from('freefree_import_candidates').update({ update_available: false }).eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath(PATH)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// FreeFree への登録
// ---------------------------------------------------------------------------

export type PublishInput = {
  ids: string[]
  /** 掲載終了日 YYYY-MM-DD（日本時間）。今日〜3か月先（FreeFree通常掲載と同じ上限） */
  endDate: string
  /** true: DBを書き換えず、登録できるか・できない理由だけ返す */
  dryRun: boolean
  allowDuplicate?: boolean
  confirmPossible?: boolean
  metaversePin?: boolean
}

export type PublishItemResult = {
  id: string
  name: string
  outcome: 'published' | 'would_publish' | 'skipped' | 'failed'
  postId?: string
  message?: string
}

export async function publishCandidates(input: PublishInput): Promise<ActionResult<{ items: PublishItemResult[]; runId: string | null }>> {
  let supabase: Supabase | null = null
  let runId: string | null = null
  try {
    const admin = await requireAdmin()
    supabase = admin.supabase
    const userId = admin.userId
    const ids = Array.from(new Set(input.ids ?? []))
    if (ids.length === 0) return { ok: false, error: '登録する候補を選択してください' }
    if (ids.length > PUBLISH_CHUNK_MAX) return { ok: false, error: `1回に登録できるのは${PUBLISH_CHUNK_MAX}件までです` }
    if (!isValidEndDate(input.endDate)) return { ok: false, error: `掲載終了日は今日から ${maxEndDate()} までの日付を選んでください` }

    if (!input.dryRun) {
      const ins = await supabase.from('freefree_import_runs')
        .insert({ actor_id: userId, kind: 'publish', params: { count: ids.length, endDate: input.endDate, allowDuplicate: !!input.allowDuplicate, confirmPossible: !!input.confirmPossible, pin: !!input.metaversePin } })
        .select('id').single()
      if (ins.error) throw new Error(ins.error.message)
      runId = ins.data.id
    }

    const { data: rows, error } = await supabase.from('freefree_import_candidates').select('*').in('id', ids)
    if (error) throw new Error(error.message)
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]))
    const expiresAt = endOfDayJstIso(input.endDate)
    const items: PublishItemResult[] = []
    const postIds: string[] = []

    for (const id of ids) {
      const c = byId.get(id)
      if (!c) { items.push({ id, name: '(不明)', outcome: 'skipped', message: '候補が見つかりません' }); continue }
      const draft = buildPostDraft(c, (c.edits ?? {}) as CandidateEdits)
      const chk = checkPublishable(c, draft, { allowDuplicate: input.allowDuplicate, confirmPossible: input.confirmPossible })
      if (!chk.ok) { items.push({ id, name: c.name, outcome: 'skipped', message: chk.reason }); continue }
      if (input.dryRun) { items.push({ id, name: c.name, outcome: 'would_publish' }); continue }

      // 二重登録防止: 状態を条件にした更新で「登録処理中」を取れた1回だけが先へ進める
      const claim = await supabase.from('freefree_import_candidates')
        .update({ import_status: 'publishing', import_error: null })
        .eq('id', id).in('import_status', ['candidate', 'failed']).select('id').maybeSingle()
      if (claim.error) { items.push({ id, name: c.name, outcome: 'failed', message: claim.error.message }); continue }
      if (!claim.data) { items.push({ id, name: c.name, outcome: 'skipped', message: '他の操作で登録済み・処理中です' }); continue }

      const pin = input.metaversePin && draft.address && c.latitude != null && c.longitude != null
        ? { metaverse_pin: true, address: draft.address, lat: c.latitude, lon: c.longitude }
        : {}
      const ins = await supabase.from('freefree_posts').insert({
        poster_type: 'member',
        poster_id: userId,
        title: draft.title,
        body: draft.body,
        category: draft.category,
        location: draft.location,
        period: 'p_until_date',
        status: 'active',
        expires_at: expiresAt,
        images: null,
        sns_share: false,          // 取込施設を CBI 公式SNSの定期紹介に載せない
        sns_display_name: null,
        links: draft.links,
        import_source: c.source === 'manual' ? 'manual' : 'openpoi',
        import_licenses: c.licenses ?? [],
        import_attributions: c.attributions ?? [],
        // 画像カードの地図に使う（メタバースのお店ピンは metaverse_pin のときだけ。下の pin）
        lat: c.latitude ?? null,
        lon: c.longitude ?? null,
        ...pin,
      }).select('id').single()

      if (ins.error || !ins.data) {
        await supabase.from('freefree_import_candidates').update({ import_status: 'failed', import_error: (ins.error?.message ?? '登録に失敗').slice(0, 500) }).eq('id', id)
        items.push({ id, name: c.name, outcome: 'failed', message: ins.error?.message ?? '登録に失敗しました' })
        continue
      }
      const done = { import_status: 'imported', freefree_post_id: ins.data.id, import_error: null }
      let upd = await supabase.from('freefree_import_candidates').update(done).eq('id', id)
      if (upd.error) upd = await supabase.from('freefree_import_candidates').update(done).eq('id', id)
      postIds.push(ins.data.id)
      items.push(upd.error
        ? { id, name: c.name, outcome: 'published', postId: ins.data.id, message: `投稿は作成済みですが候補の状態更新に失敗しました（${upd.error.message}）。二重登録を防ぐため「登録処理中」のままにしています` }
        : { id, name: c.name, outcome: 'published', postId: ins.data.id })
    }

    if (!input.dryRun) {
      const counts = {
        published: items.filter((i) => i.outcome === 'published').length,
        skipped: items.filter((i) => i.outcome === 'skipped').length,
        failed: items.filter((i) => i.outcome === 'failed').length,
      }
      await supabase.from('freefree_import_runs').update({
        status: counts.failed > 0 ? (counts.published > 0 ? 'partial' : 'failed') : 'success',
        counts, finished_at: new Date().toISOString(),
      }).eq('id', runId!)
      await recordWrite({ actorId: userId, action: 'freefree.import', targetType: 'freefree_import', targetId: runId, isAdmin: true, detail: { kind: 'publish', ...counts, post_ids: postIds } })
      revalidatePath(PATH)
      revalidatePath('/freefree')
      revalidatePath('/admin/freefree')
    }
    return { ok: true, data: { items, runId } }
  } catch (e) {
    const msg = errMsg(e)
    if (runId && supabase) {
      await supabase.from('freefree_import_runs').update({ status: 'failed', error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', runId)
    }
    return { ok: false, error: msg }
  }
}

// ---------------------------------------------------------------------------
// 紹介文の下書き（AI）
// ---------------------------------------------------------------------------
// 口コミ・評価は使わない。公開データの事実と、運営が貼ったお店自身の公式情報だけで書く（決まりは buildIntroPrompt）。
// 下書きは保存せず画面に返すだけ。運営が読んで直し、「修正内容を保存」を押して初めて保存される。

const INTRO_MODEL = 'claude-haiku-4-5'
const INTRO_INTERVAL_MS = 2_000
const lastIntro = new Map<string, number>() // best-effort（サーバーレスではインスタンスごと）

export async function draftIntro(
  candidateId: string,
  reference: string,
): Promise<ActionResult<{ text: string; risky: string[] }>> {
  try {
    const { supabase, userId } = await requireAdmin()
    if (Date.now() - (lastIntro.get(userId) ?? 0) < INTRO_INTERVAL_MS) return { ok: false, error: '連続で実行できません。少し待ってからもう一度お試しください' }
    lastIntro.set(userId, Date.now())
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return { ok: false, error: 'AIの設定（ANTHROPIC_API_KEY）がありません' }
    if (typeof reference !== 'string' || reference.length > 8000) return { ok: false, error: '参考テキストは8000字までにしてください' }

    const { data: c, error } = await supabase
      .from('freefree_import_candidates')
      .select('name, prefecture, city, address, openpoi_category')
      .eq('id', candidateId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!c) return { ok: false, error: '候補が見つかりません' }

    const { system, user } = buildIntroPrompt(
      {
        name: normalizeDisplayText(c.name),
        kind: openpoiCategoryLabel(c.openpoi_category),
        prefecture: c.prefecture,
        city: c.city,
        area: areaFromAddress(c.address, c.city),
        address: c.address ? normalizeDisplayText(c.address) : null,
      },
      reference,
    )
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: INTRO_MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const text = sanitizeIntro(raw)
    if (!text) return { ok: false, error: 'AIが紹介文を作れませんでした。もう一度お試しください' }
    return { ok: true, data: { text, risky: findRiskyPhrases(text) } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `AIの呼び出しに失敗しました: ${e.message}` : 'AIの呼び出しに失敗しました' }
  }
}

// ---------------------------------------------------------------------------
// 候補を手で追加（OpenPOI にないお店）
// ---------------------------------------------------------------------------
// 運営が、お店の名前・住所などを入れて候補にする。そのあとは取込と同じ流れ
// （重複の確認 → 紹介文 → プレビュー → 登録）。住所があれば国土地理院の住所検索で座標にする。

const CATEGORY_KEYS = ['food', 'retail', 'education', 'craft', 'living', 'startup', 'event', 'volunteer']
const lastManual = new Map<string, number>()

export type ManualCandidateInput = {
  name: string
  address?: string
  category?: string
  phone?: string
  website?: string
  openingHours?: string
  description?: string
}

export async function addManualCandidate(
  input: ManualCandidateInput,
): Promise<ActionResult<{ id: string; duplicate: { status: string; reason: string | null }; located: boolean; locateNote: string | null }>> {
  try {
    const { supabase, userId } = await requireAdmin()
    if (Date.now() - (lastManual.get(userId) ?? 0) < 1_000) return { ok: false, error: '連続で実行できません。少し待ってからもう一度お試しください' }
    lastManual.set(userId, Date.now())

    const name = normalizeDisplayText(String(input.name ?? ''))
    if (name.length < 1 || Array.from(name).length > 60) return { ok: false, error: '店名は1〜60字で入力してください' }
    const address = normalizeDisplayText(String(input.address ?? '')) || null
    if (address && Array.from(address).length > 200) return { ok: false, error: '住所は200字までにしてください' }
    const website = String(input.website ?? '').trim()
    if (website && !/^https?:\/\//i.test(website)) return { ok: false, error: 'WebサイトのURLは http:// か https:// で始めてください' }
    const category = String(input.category ?? '')
    if (category && !CATEGORY_KEYS.includes(category)) return { ok: false, error: 'カテゴリーが正しくありません' }
    const phone = String(input.phone ?? '').trim().slice(0, 40)
    const hours = String(input.openingHours ?? '').trim().slice(0, 300)
    const description = String(input.description ?? '').trim().slice(0, 500)
    if (findRiskyPhrases(description).length > 0) {
      return { ok: false, error: `紹介文に評価・推測にあたる言葉があります（${findRiskyPhrases(description).join('、')}）。口コミ・評価は書かない方針です` }
    }

    // 住所 → 座標（国土地理院の住所検索）。取れなくても候補は作る（運営があとで直せる）
    let lat: number | null = null
    let lon: number | null = null
    let locateNote: string | null = null
    if (address) {
      const g = await geocodeAddress(address)
      if (!g) locateNote = '住所から位置を特定できませんでした（座標なしで追加しました）'
      else if (!isNearInzai(g.lat, g.lon)) locateNote = `住所が印西市から遠い場所（${g.title || '不明'}）と判定されたため、座標は保存しませんでした`
      else { lat = g.lat; lon = g.lon }
    }

    // 重複の確認（FreeFree の掲載と、ほかの候補）
    const records: DedupRecord[] = []
    const cands = await loadAll<{ id: string; name: string; address: string | null; latitude: number | null; longitude: number | null; phone: string | null; website: string | null }>(
      (from, to) => supabase.from('freefree_import_candidates').select('id, name, address, latitude, longitude, phone, website').neq('import_status', 'excluded').order('id').range(from, to),
    )
    for (const c of cands) records.push({ kind: 'candidate', id: c.id, name: c.name, address: c.address, lat: c.latitude, lon: c.longitude, phone: c.phone, website: c.website })
    const posts = await loadAll<{ id: string; title: string; body: string | null; address: string | null; location: string | null; lat: number | null; lon: number | null; links: { url?: string }[] | null }>(
      (from, to) => supabase.from('freefree_posts').select('id, title, body, address, location, lat, lon, links').neq('status', 'removed').order('id').range(from, to),
    )
    for (const p of posts) records.push(postToDedupRecord(p))
    const dup = new DedupIndex(records).judge({ name, address, lat, lon, phone, website })

    const { data, error } = await supabase
      .from('freefree_import_candidates')
      .insert({
        source: 'manual',
        source_id: makeManualSourceId(name, address),
        region_key: 'manual',
        name,
        prefecture: '千葉県',
        city: '印西市',
        address,
        latitude: lat,
        longitude: lon,
        phone: phone || null,
        website: website || null,
        opening_hours: hours || null,
        description: description || null,
        licenses: [],
        attributions: [],
        raw_data: { manual: true, added_by: userId },
        category: category || null,
        category_reason: category ? '運営が指定' : '未分類（運営が手で追加）',
        import_status: 'candidate',
        ...dupFields(dup),
      })
      .select('id')
      .single()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return { ok: false, error: '同じ店名・住所の候補がすでにあります' }
      throw new Error(error.message)
    }
    await recordWrite({ actorId: userId, action: 'freefree.import', targetType: 'freefree_import', targetId: data.id, isAdmin: true, detail: { kind: 'manual_add', name } })
    revalidatePath(PATH)
    return { ok: true, data: { id: data.id, duplicate: { status: dup.status, reason: dup.reason }, located: lat !== null, locateNote } }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// SNS 投稿の下書き（登録済みの取込掲載）
// ---------------------------------------------------------------------------
// 下書きを作るだけ。運営が /admin/sns で文面を確認して承認すると、Threads・Instagram に出る（常に承認制）。
// 1日に作れる件数の上限（初期値3件）は app_settings の freefree_import_sns_daily_cap（{ "perDay": 数 }）で変える。

export type SnsDraftItem = { name: string; outcome: 'created' | 'skipped'; message?: string }

export async function createSnsDrafts(
  candidateIds: string[],
): Promise<ActionResult<{ items: SnsDraftItem[]; usedToday: number; perDay: number }>> {
  try {
    const { supabase } = await requireAdmin()
    const ids = Array.from(new Set(candidateIds ?? []))
    if (ids.length === 0 || ids.length > 10) return { ok: false, error: '対象は1〜10件で指定してください' }

    // 1日の上限と、今日すでに作った件数（取込掲載のみ・日本時間）
    const { data: setting } = await supabase.from('app_settings').select('value').eq('key', 'freefree_import_sns_daily_cap').maybeSingle()
    const rawCap = Number((setting?.value as { perDay?: unknown } | null)?.perDay)
    const perDay = Number.isFinite(rawCap) && rawCap >= 0 ? Math.floor(rawCap) : SNS_DAILY_CAP_DEFAULT
    const dayStart = new Date(`${jstToday()}T00:00:00+09:00`).toISOString()
    const { data: todayLogs } = await supabase.from('sns_post_logs').select('target_id').eq('target_type', 'freefree').gte('created_at', dayStart).limit(1000)
    const todayTargets = Array.from(new Set((todayLogs ?? []).map((l) => l.target_id as string)))
    let usedToday = 0
    if (todayTargets.length > 0) {
      const { data: imported } = await supabase.from('freefree_posts').select('id').in('id', todayTargets).not('import_source', 'is', null)
      usedToday = imported?.length ?? 0
    }

    const { data: rows, error } = await supabase.from('freefree_import_candidates').select('id, name, import_status, freefree_post_id').in('id', ids)
    if (error) throw new Error(error.message)
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]))
    const items: SnsDraftItem[] = []

    for (const id of ids) {
      const c = byId.get(id)
      if (!c) { items.push({ name: '(不明)', outcome: 'skipped', message: '候補が見つかりません' }); continue }
      const name = String(c.name)
      if (c.import_status !== 'imported' || !c.freefree_post_id) { items.push({ name, outcome: 'skipped', message: 'FreeFreeに登録済みの候補だけ、SNSの下書きを作れます' }); continue }
      const postId = c.freefree_post_id as string
      // 同じ掲載に、すでに下書きや投稿があれば作らない（二重の告知を防ぐ）
      const { data: existing } = await supabase.from('sns_post_logs').select('id').eq('target_type', 'freefree').eq('target_id', postId).limit(1)
      if (existing && existing.length > 0) { items.push({ name, outcome: 'skipped', message: 'すでに下書きまたは投稿があります' }); continue }
      if (remainingDailyCap(perDay, usedToday) <= 0) { items.push({ name, outcome: 'skipped', message: `本日の上限（${perDay}件）に達しました。明日、または設定で上限を変えてください` }); continue }
      const r = await announceFreefreeToSns({ id: postId, title: name }, { forceApproval: true, label: `取込掲載「${name}」` })
      if (r.created > 0) { usedToday++; items.push({ name, outcome: 'created' }) }
      else items.push({ name, outcome: 'skipped', message: '下書きを作れませんでした（掲載が公開中でない、など）' })
    }
    revalidatePath(PATH)
    return { ok: true, data: { items, usedToday, perDay } }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// ピンの置き直し（地図をクリックして位置を直す）
// ---------------------------------------------------------------------------
// 住所から求めた座標は街区の代表点なので、実際のお店の位置とずれることがある。
// 運営が地図で位置を指定する。候補の座標を直し、登録済みなら FreeFree 掲載の座標も直す。
// ・直した候補は edited=true にして、OpenPOI の再取得で座標が戻らないようにする
// ・掲載の更新は座標（lat/lon）だけ。取込で作った掲載（import_source あり）に限る
//   （掲載の投稿者は団体なので、運営のセッションでは RLS で更新できない。管理者確認のあと service role で行う）

export async function setCandidatePin(
  id: string,
  lat: number,
  lon: number,
): Promise<ActionResult<{ postUpdated: boolean }>> {
  try {
    const { supabase, userId } = await requireAdmin()
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: '位置が正しくありません' }
    if (!isNearInzai(lat, lon)) return { ok: false, error: '印西市周辺から遠い位置です。地図を確かめてください' }
    const la = Math.round(lat * 1e6) / 1e6
    const lo = Math.round(lon * 1e6) / 1e6

    const { data: c, error: ce } = await supabase
      .from('freefree_import_candidates')
      .select('id, freefree_post_id, import_status')
      .eq('id', id)
      .maybeSingle()
    if (ce) return { ok: false, error: errMsg(ce) }
    if (!c) return { ok: false, error: '候補が見つかりません' }
    if (c.import_status === 'publishing') return { ok: false, error: '登録処理中です。少し待ってからお試しください' }

    let postUpdated = false
    if (c.freefree_post_id) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      if (!url || !key) return { ok: false, error: 'サーバーの設定が足りないため、掲載の位置を直せません' }
      const admin = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: upd, error: pe } = await admin
        .from('freefree_posts')
        .update({ lat: la, lon: lo })
        .eq('id', c.freefree_post_id)
        .not('import_source', 'is', null)
        .select('id')
      if (pe) return { ok: false, error: errMsg(pe) }
      postUpdated = (upd?.length ?? 0) > 0
      if (!postUpdated) return { ok: false, error: '取込で作った掲載が見つかりませんでした（位置は変更していません）' }
    }

    const { error: ue } = await supabase
      .from('freefree_import_candidates')
      .update({ latitude: la, longitude: lo, edited: true })
      .eq('id', id)
    if (ue) return { ok: false, error: errMsg(ue) }

    await recordWrite({
      actorId: userId, action: 'freefree.import', targetType: 'freefree_import_candidate', targetId: id,
      detail: { op: 'set_pin', lat: la, lon: lo, post: c.freefree_post_id ?? null }, isAdmin: true,
    })
    revalidatePath(PATH)
    if (c.freefree_post_id) revalidatePath(`/freefree/${c.freefree_post_id}`)
    return { ok: true, data: { postUpdated } }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// お店の Instagram を登録する
// ---------------------------------------------------------------------------
// 運営が目で見て確かめたアカウントだけを登録する（OpenPOI からは入らない）。掲載ページに「Instagram」のリンクとして出る。
// ・候補の edits.instagram に保存（登録前の候補は、登録時に掲載のリンクへ入る）
// ・登録済みなら掲載の links も直す（Instagram のリンクだけ入れ替え。ほかのリンクは触らない）
// ・SNS の投稿文には使わない（お店を @タグ付けしない方針）
// 空文字で登録を外す。

export async function setCandidateInstagram(id: string, input: string): Promise<ActionResult<{ url: string | null; postUpdated: boolean }>> {
  try {
    const { supabase, userId } = await requireAdmin()
    const raw = String(input ?? '').trim()
    const url = raw ? normalizeInstagramUrl(raw) : null
    if (raw && !url) return { ok: false, error: 'Instagram はアカウント名か、アカウントの URL を入れてください（投稿の URL は使えません）' }

    const { data: c, error: ce } = await supabase
      .from('freefree_import_candidates')
      .select('id, edits, freefree_post_id, import_status')
      .eq('id', id)
      .maybeSingle()
    if (ce) return { ok: false, error: errMsg(ce) }
    if (!c) return { ok: false, error: '候補が見つかりません' }
    if (c.import_status === 'publishing') return { ok: false, error: '登録処理中です。少し待ってからお試しください' }

    let postUpdated = false
    if (c.freefree_post_id) {
      const sUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      if (!sUrl || !key) return { ok: false, error: 'サーバーの設定が足りないため、掲載のリンクを直せません' }
      const admin = createServiceClient(sUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: post, error: pe } = await admin
        .from('freefree_posts')
        .select('id, links, import_source')
        .eq('id', c.freefree_post_id)
        .maybeSingle()
      if (pe) return { ok: false, error: errMsg(pe) }
      if (!post || !post.import_source) return { ok: false, error: '取込で作った掲載が見つかりませんでした（変更していません）' }
      const kept = (Array.isArray(post.links) ? post.links : []).filter((l: { label?: string }) => l?.label !== INSTAGRAM_LINK_LABEL)
      const links = url ? [...kept, { label: INSTAGRAM_LINK_LABEL, url }] : kept
      if (links.length > 5) return { ok: false, error: 'リンクは5件までです。ほかのリンクを減らしてからお試しください' }
      const { error: ue } = await admin.from('freefree_posts').update({ links }).eq('id', post.id)
      if (ue) return { ok: false, error: errMsg(ue) }
      postUpdated = true
    }

    const edits = { ...((c.edits ?? {}) as Record<string, string>) }
    if (url) edits.instagram = url
    else delete edits.instagram
    const edited = Object.values(edits).some((v) => v !== '')
    const { error: ue2 } = await supabase.from('freefree_import_candidates').update({ edits, edited }).eq('id', id)
    if (ue2) return { ok: false, error: errMsg(ue2) }

    await recordWrite({
      actorId: userId, action: 'freefree.import', targetType: 'freefree_import_candidate', targetId: id,
      detail: { op: 'set_instagram', url, post: c.freefree_post_id ?? null }, isAdmin: true,
    })
    revalidatePath(PATH)
    if (c.freefree_post_id) revalidatePath(`/freefree/${c.freefree_post_id}`)
    return { ok: true, data: { url, postUpdated } }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}
