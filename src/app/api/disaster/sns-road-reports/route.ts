// SNS投稿から AI が読み取った通行情報（未確認）。
// GET  : 一般向け（confidence=high・hidden=false だけ・120秒の配信キャッシュ）。?all=1＋合言葉で運営向け全件
// POST : 未判定の候補を AI に掛ける（合言葉か CRON_SECRET）。?limit= で件数（既定6・最大60）
// PATCH: ?id=… 運営の操作（合言葉）。どの操作も disaster_sns_road_feedback に残し、AI に「過去の判断例」として添える
//   {hidden:true|false, reason?}                 伏せる／戻す。reason は not_road|wrong_place|stale|other
//   {move:{lat,lng,placeName,learn,publish}}     地図で置き直す。learn なら地名を disaster_sns_places に覚え、
//                                                同じ地名で場所が決まらず伏せていた投稿も置き直す。publish なら確度を高にして一般公開
//   {section:{from:{lat,lng,name},to:{lat,lng,name},learn,publish}}
//                                                運営が始点・終点を地図で指定し、国道464号の道なりの線（区間）にする（2026-09-25 事業主指示C）。
//                                                learn なら2つの地名を覚え、次から「A〜B」「AからB」の投稿は AI が自動で線にする
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  coreLocationName, inArea, loadLearnedPlaces, locateRoadReport, locateSection, MOVED_BASIS, path464, processSnsRoadCandidates,
  SNS_FEEDBACK_TABLE, SNS_PLACES_TABLE, SNS_ROAD_EVENT_START, SNS_ROAD_TABLE, toPublicReport, UNLOCATED_BASIS,
} from '@/lib/disaster-sns-road-ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173', 'http://localhost:4173',
  'http://127.0.0.1:8766', 'http://localhost:8766',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Access-Control-Max-Age': '86400', Vary: 'Origin', 'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// 通れた道APIと同じ合言葉（DISASTER_MODERATION_KEY、無ければ CRON_SECRET）
function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  const given = request.headers.get('x-moderation-key') ?? ''
  return Boolean(key) && given.length >= 16 && given === key
}

function isCron(request: Request) {
  const secret = process.env.CRON_SECRET ?? ''
  const auth = request.headers.get('authorization') ?? ''
  return Boolean(secret) && auth === `Bearer ${secret}`
}

export async function GET(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const url = new URL(request.url)
  const wantAll = url.searchParams.has('all')
  if (wantAll && !isModerator(request)) return json(request, { error: 'forbidden' }, 403)

  let query = supabase.from(SNS_ROAD_TABLE)
    .select('id, kind, latitude, longitude, location_name, location_basis, observed_at, posted_at, permalink, platform, confidence, summary, quote, hidden, image_note, embed_url, path, section_label')
    .gte('posted_at', SNS_ROAD_EVENT_START).order('posted_at', { ascending: false }).limit(500)
  if (!wantAll) query = query.eq('hidden', false).eq('confidence', 'high')
  const { data, error } = await query
  if (error) return json(request, { error: 'read_failed' }, 500)

  const response = json(request, {
    generatedAt: new Date().toISOString(),
    eventStart: SNS_ROAD_EVENT_START,
    count: (data ?? []).length,
    reports: (data ?? []).map((row) => toPublicReport(row as Record<string, unknown>)),
    note: 'SNSの投稿をAIが読み取った未確認の情報です。点は投稿が指す場所の目安で、いま通れるかどうかを保証しません。',
  })
  // 一般向けだけ配信側で120秒使い回す（無料枠の呼び出し回数対策。sns-monitor と同じ考え）
  if (!wantAll) response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=240')
  return response
}

export async function POST(request: Request) {
  if (!isModerator(request) && !isCron(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 6)
  try {
    const result = await processSnsRoadCandidates(supabase, { limit: Number.isFinite(limit) ? limit : 6 })
    return json(request, { ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/sns-road-reports]', message)
    return json(request, { error: message }, 500)
  }
}

export async function PATCH(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(request, { error: 'invalid_id' }, 400)
  type EndPoint = { lat?: unknown; lng?: unknown; name?: unknown }
  let body: {
    hidden?: unknown; reason?: unknown
    move?: { lat?: unknown; lng?: unknown; placeName?: unknown; learn?: unknown; publish?: unknown }
    section?: { from?: EndPoint; to?: EndPoint; learn?: unknown; publish?: unknown }
  }
  try { body = await request.json() } catch { return json(request, { error: 'invalid_json' }, 400) }
  const { data: report } = await supabase.from(SNS_ROAD_TABLE).select('id, candidate_id, kind, location_name, confidence').eq('id', id).maybeSingle()
  if (!report) return json(request, { error: 'not_found' }, 404)
  const now = new Date().toISOString()

  if (body?.move) {
    const lat = Number(body.move.lat), lng = Number(body.move.lng)
    const placeName = String(body.move.placeName ?? '').normalize('NFKC').trim().slice(0, 40)
    if (!inArea(lat, lng)) return json(request, { error: 'out_of_area' }, 400)
    const learn = body.move.learn === true && coreLocationName(placeName).length >= 2
    const publish = body.move.publish === true
    const { error } = await supabase.from(SNS_ROAD_TABLE).update({
      latitude: lat, longitude: lng, path: null, section_label: '', hidden: false,
      location_basis: `${MOVED_BASIS}${placeName ? `（地名「${placeName}」）` : ''}`,
      confidence: publish ? 'high' : report.confidence === 'high' ? 'medium' : report.confidence, updated_at: now,
    }).eq('id', id)
    if (error) return json(request, { error: 'update_failed' }, 500)
    await recordFeedback(supabase, report, { action: 'move', place_name: placeName, lat, lng })
    let relocated = 0
    if (learn) {
      await supabase.from(SNS_PLACES_TABLE).upsert({ name: placeName, lat, lng, source: 'moderator', basis: '運営が地図で指定', updated_at: now }, { onConflict: 'name' })
      relocated = await relocateUnlocated(supabase, placeName)
    }
    return json(request, { ok: true, id, moved: true, learned: learn, relocated })
  }

  if (body?.section) {
    const ends = [body.section.from, body.section.to].map((e) => ({
      lat: Number(e?.lat), lng: Number(e?.lng), name: String(e?.name ?? '').normalize('NFKC').trim().slice(0, 40),
    }))
    if (ends.some((e) => !inArea(e.lat, e.lng))) return json(request, { error: 'out_of_area' }, 400)
    const path = path464([ends[0].lat, ends[0].lng], [ends[1].lat, ends[1].lng])
    if (!path) return json(request, { error: 'no_route', hint: '2点が国道464号（北千葉道路・宗吾街道を含む）から300m以内で、道なりに20km以内につながる必要があります' }, 400)
    const learn = body.section.learn === true
    const publish = body.section.publish === true
    const label = `${ends[0].name || '始点'}〜${ends[1].name || '終点'}`
    const mid = path[Math.floor(path.length / 2)]
    const { error } = await supabase.from(SNS_ROAD_TABLE).update({
      latitude: mid[0], longitude: mid[1], path, section_label: label, hidden: false,
      location_basis: `${MOVED_BASIS}（区間 ${label}・道路の形は © OpenStreetMap contributors）`,
      confidence: publish ? 'high' : report.confidence === 'high' ? 'medium' : report.confidence, updated_at: now,
    }).eq('id', id)
    if (error) return json(request, { error: 'update_failed' }, 500)
    await recordFeedback(supabase, report, { action: 'section', place_name: label, lat: mid[0], lng: mid[1] })
    let learned = 0
    if (learn) {
      for (const e of ends) {
        if (coreLocationName(e.name).length < 2) continue
        const { error: placeError } = await supabase.from(SNS_PLACES_TABLE).upsert({ name: e.name, lat: e.lat, lng: e.lng, source: 'moderator', basis: '運営が区間の端として地図で指定', updated_at: now }, { onConflict: 'name' })
        if (!placeError) learned += 1
      }
    }
    return json(request, { ok: true, id, section: label, points: path.length, learned })
  }

  if (typeof body?.hidden !== 'boolean') return json(request, { error: 'invalid_hidden' }, 400)
  const reason = ['not_road', 'wrong_place', 'stale', 'other'].includes(String(body.reason)) ? String(body.reason) : ''
  const { data, error } = await supabase.from(SNS_ROAD_TABLE)
    .update({ hidden: body.hidden, updated_at: now }).eq('id', id).select('id, hidden').maybeSingle()
  if (error) return json(request, { error: 'update_failed' }, 500)
  if (!data) return json(request, { error: 'not_found' }, 404)
  await recordFeedback(supabase, report, { action: body.hidden ? 'hide' : 'unhide', reason })
  return json(request, { ok: true, id: data.id, hidden: data.hidden })
}

// 運営の操作を判断例として残す。本文の抜粋は候補（disaster_sns_candidates）から取る
async function recordFeedback(supabase: SupabaseClient, report: { id: string; candidate_id: string; kind: string }, fields: Record<string, unknown>) {
  const { data: candidate } = await supabase.from('disaster_sns_candidates').select('body_text').eq('id', report.candidate_id).maybeSingle()
  await supabase.from(SNS_FEEDBACK_TABLE).insert({
    report_id: report.id, candidate_id: report.candidate_id, kind: report.kind,
    body_excerpt: String(candidate?.body_text ?? '').replace(/\s+/g, ' ').slice(0, 300), ...fields,
  })
}

// 地名を覚えたら、同じ地名を含む「場所を特定できず」の投稿を置き直す（最大30件）。
// 運営が手で伏せたものは触らない（location_basis が UNLOCATED_BASIS で始まるものだけ）
async function relocateUnlocated(supabase: SupabaseClient, placeName: string) {
  const learned = await loadLearnedPlaces(supabase)
  const core = coreLocationName(placeName)
  const { data } = await supabase.from(SNS_ROAD_TABLE).select('id, location_name, confidence')
    .like('location_basis', `${UNLOCATED_BASIS}%`).limit(300)
  let count = 0
  for (const row of (data ?? []).filter((r) => coreLocationName(String(r.location_name)).includes(core)).slice(0, 30)) {
    const section = locateSection({ location_text: String(row.location_name), section_from: '', section_to: '' }, learned)
    const located = section ?? await locateRoadReport({ location_text: String(row.location_name) }, fetch, learned)
    if (!located) continue
    await supabase.from(SNS_ROAD_TABLE).update({
      latitude: located.lat, longitude: located.lng, location_basis: located.basis, path: section?.path ?? null,
      section_label: section?.label ?? '', hidden: false, updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    count++
  }
  return count
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
