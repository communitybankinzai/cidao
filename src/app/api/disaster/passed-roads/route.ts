// 防災MAP「通れた道」「通れない地点」API。
// GET : 印西市域の記録を返す（GitHub Pages の災害MAPが読む）。
//       6時間以内＝「いま通れた道」／それ以前＝「冠水時に通れた実績」の判定は画面側で行う。
//       ?format=geojson で GeoJSON（みんつく千葉冠水マップ運営への提供用。kind=blocked で通れない地点だけ）。
// POST: 閲覧者のスマホが記録した軌跡（kind=passed）または現在地1点（kind=blocked）を保存する
//       （匿名・端末IDと IP ハッシュで間隔制限）。
// DELETE: 自分の記録の取り消し（同じ端末ID・送信から10分以内だけ。行は消さず hidden=true にする）。
//       誤タップやテスト送信で自宅の位置が公開されたままにならないようにするため。
// テーブル未作成時は 503 でマイグレーション実行の案内を返す（timeline と同じ流儀）。

import { createHash } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { distanceM, rainAt, type LatLon, type RainInfo } from '@/lib/disaster-amedas-rain'
import { normalizeRoadMediaUrls } from '@/lib/disaster-road-media'

export const dynamic = 'force-dynamic'

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
])

const MIGRATION_HINT = 'disaster_passed_roads table not found. Run migration 20260918100000.'

// kansui/route.ts と同じ枠
// 千葉県全域を囲む四角（2026-09-22 に印西市周辺から拡大）
const WEST = 139.70
const SOUTH = 34.85
const EAST = 140.90
const NORTH = 36.15

const MIN_POINTS = 3
const MAX_POINTS = 2000
const MIN_LENGTH_M = 50
const KINDS = new Set(['passed', 'blocked'])
const SOURCES = new Set(['gps', 'map']) // gps=現地でGPS記録／map=地図の長押しで後から指定
const MAX_LENGTH_M = 30000
// 後から登録してよい災害の期間（2026-09-25）。ここに書いたものだけ、24時間より前でも受ける。
// 画面の「いつの状況？」の選択肢と揃えること（site/inzai-disaster-map の index.html・app.js）。
// 新しい災害を足すときは、始まりと終わりを実際の発生に合わせて書く。
const PAST_EVENTS = [
  { key: 'typhoon25', label: '台風25号', from: Date.parse('2026-09-20T00:00:00+09:00'), to: Date.parse('2026-09-24T23:59:59+09:00') },
  { key: 'aug2026', label: '8月の豪雨', from: Date.parse('2026-08-13T00:00:00+09:00'), to: Date.parse('2026-08-16T23:59:59+09:00') },
]

const MAX_NOTE = 200

// 運営（いたずら対応）用の合言葉。Vercel の環境変数 DISASTER_MODERATION_KEY に置く。
// 一致したときだけ、端末IDと10分の制限なしで hidden を切り替えられる（行は消さない）。
// 合言葉が未設定の環境では運営操作を一切受け付けない（事故防止）
function isModerator(request: Request) {
  // 専用の DISASTER_MODERATION_KEY があればそれを使い、無ければ既存の CRON_SECRET を使う
  // （Vercel に新しい環境変数を足さずに運用を始めるため。専用キーを設定すればそちらが優先される）
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  if (!key) return false
  const given = request.headers.get('x-moderation-key') ?? ''
  return given.length >= 16 && given === key
}
// 同じ端末・同じ IP からの連続投稿の間隔（2026-09-21 に120秒→30秒。運営の合言葉付きの送信は判定しない）
const MIN_INTERVAL_SECONDS = 30
const LIST_LIMIT = 2000
const UNDO_WINDOW_SECONDS = 600 // 自分の記録を取り消せる時間

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST200') return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(error.message ?? '')
}

function insideInzai([lat, lon]: LatLon) {
  return lon >= WEST && lon <= EAST && lat >= SOUTH && lat <= NORTH
}

function pathLengthM(path: LatLon[]) {
  let total = 0
  for (let i = 1; i < path.length; i += 1) total += distanceM(path[i - 1], path[i])
  return total
}

// [[lat, lon], ...] を検証して小数6桁に丸める（約10cm。それ以上の精度は個人特定にも役立たない）
function normalizePath(raw: unknown, minPoints: number): LatLon[] | null {
  if (!Array.isArray(raw) || raw.length < minPoints || raw.length > MAX_POINTS) return null
  const out: LatLon[] = []
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) return null
    const lat = Number(point[0])
    const lon = Number(point[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
    out.push([Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6])
  }
  return out
}

function ipHash(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || ''
  if (!ip) return ''
  return createHash('sha256').update(`passed-roads:${ip}`).digest('hex').slice(0, 32)
}

// 「今回の大雨」の開始日時（2026-09-22）。防災MAPは、これより後の「通れた道」を濃く、前を薄く描く。
// 次の大雨のときは運営が合言葉つきで入れ替える（PATCH ?setting=eventStart）
const EVENT_START_KEY = 'disaster_event_start'
const EVENT_START_DEFAULT = '2026-09-20T15:00:00.000Z' // 2026-09-21 0:00（日本時間）・台風25号
async function readEventStart(supabase: NonNullable<ReturnType<typeof serviceClient>>): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', EVENT_START_KEY).maybeSingle()
  const at = (data?.value as { at?: string } | null)?.at
  return at && !Number.isNaN(Date.parse(at)) ? at : EVENT_START_DEFAULT
}

async function getUncached(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)

  const { searchParams } = new URL(request.url)
  const kindParam = searchParams.get('kind') ?? ''
  const format = searchParams.get('format') ?? 'json'

  // 運営用：伏せた記録も含めて返す（合言葉が合っているときだけ）
  const wantAll = searchParams.get('all') === '1' && isModerator(request)

  let query = supabase
    .from('disaster_passed_roads')
    .select('id, kind, source, path, point_count, length_m, started_at, ended_at, note, image_urls, source_urls, created_at, hidden, rain_station, rain_at, rain_1h_mm, rain_3h_mm, rain_24h_mm, rain_verdict')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (!wantAll) query = query.eq('hidden', false)
  if (KINDS.has(kindParam)) query = query.eq('kind', kindParam)
  const { data, error } = await query

  if (isMissingTable(error)) return json(request, { error: MIGRATION_HINT }, 503)
  if (error) return json(request, { error: error.message }, 500)

  const rainOf = (row: { rain_station?: string; rain_at?: string | null; rain_1h_mm?: unknown; rain_3h_mm?: unknown; rain_24h_mm?: unknown; rain_verdict?: string }) => ({
    station: row.rain_station ?? '',
    at: row.rain_at ?? null,
    r1h: row.rain_1h_mm === null || row.rain_1h_mm === undefined ? null : Number(row.rain_1h_mm),
    r3h: row.rain_3h_mm === null || row.rain_3h_mm === undefined ? null : Number(row.rain_3h_mm),
    r24h: row.rain_24h_mm === null || row.rain_24h_mm === undefined ? null : Number(row.rain_24h_mm),
    verdict: row.rain_verdict ?? 'unknown',
  })

  // みんつく運営など外部への提供用。GeoJSON は [経度, 緯度] の順
  if (format === 'geojson') {
    return json(request, {
      type: 'FeatureCollection',
      generatedAt: new Date().toISOString(),
      source: 'CBI 印西市 災害状況整合MAP（閲覧者の匿名投稿・公式に確認された情報ではありません）',
      features: (data ?? []).map((row) => {
        const path = (row.path as LatLon[]).map(([lat, lon]) => [lon, lat])
        return {
          type: 'Feature',
          id: row.id,
          geometry: path.length === 1 ? { type: 'Point', coordinates: path[0] } : { type: 'LineString', coordinates: path },
          properties: {
            kind: row.kind,
            source: row.source,
            recordedAt: row.ended_at,
            note: row.note ?? '',
            imageUrls: normalizeRoadMediaUrls(row.image_urls ?? []) ?? [],
            sourceUrls: normalizeRoadMediaUrls(row.source_urls ?? []) ?? [],
            lengthM: Number(row.length_m),
            rain: rainOf(row),
          },
        }
      }),
    })
  }

  const eventStart = await readEventStart(supabase)
  return json(request, {
    generatedAt: new Date().toISOString(),
    eventStart,
    count: data?.length ?? 0,
    roads: (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      source: row.source,
      path: row.path as LatLon[],
      pointCount: row.point_count,
      lengthM: Number(row.length_m),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      note: row.note ?? '',
      imageUrls: normalizeRoadMediaUrls(row.image_urls ?? []) ?? [],
      sourceUrls: normalizeRoadMediaUrls(row.source_urls ?? []) ?? [],
      createdAt: row.created_at,
      hidden: Boolean(row.hidden),
      rain: rainOf(row),
    })),
  })
}

export async function POST(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)

  let body: { deviceId?: unknown; kind?: unknown; source?: unknown; path?: unknown; startedAt?: unknown; endedAt?: unknown; note?: unknown; sourceUrls?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json(request, { error: 'invalid_json' }, 400)
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 64) : ''
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return json(request, { error: 'invalid_device_id' }, 400)

  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'passed'
  const source = typeof body.source === 'string' && SOURCES.has(body.source) ? body.source : 'gps'
  // 地点（1点）は従来どおり可。地図で描いた線は2点から、GPS軌跡は3点・50m以上。
  const path = normalizePath(body.path, 1)
  if (!path) return json(request, { error: 'invalid_path', hint: `1〜${MAX_POINTS}点の [緯度, 経度] 配列` }, 400)
  const minLinePoints = source === 'map' ? 2 : MIN_POINTS
  if (path.length > 1 && path.length < minLinePoints) return json(request, { error: 'invalid_path', hint: `線は${minLinePoints}点以上` }, 400)
  if (!path.some(insideInzai)) return json(request, { error: 'outside_inzai' }, 400)

  const lengthM = path.length === 1 ? 0 : pathLengthM(path)
  if (source === 'gps' && path.length > 1 && lengthM < MIN_LENGTH_M) return json(request, { error: 'too_short', lengthM: Math.round(lengthM) }, 400)
  if (lengthM > MAX_LENGTH_M) return json(request, { error: 'too_long', lengthM: Math.round(lengthM) }, 400)

  const startedAt = new Date(String(body.startedAt ?? ''))
  const endedAt = new Date(String(body.endedAt ?? ''))
  const now = Date.now()
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return json(request, { error: 'invalid_time' }, 400)
  if (endedAt.getTime() < startedAt.getTime()) return json(request, { error: 'invalid_time' }, 400)
  // 端末時計のずれは許すが、1日以上ずれた記録は受けない（過去の記録を後から捏造させない）。
  // ただし、決まった災害の期間の中に入る時刻だけは後からでも受ける（2026-09-25）。
  // 台風25号の冠水を集め直すことになったが、選べる時刻が12時間前までで登録できなかったため。
  // ⚠ 期間は下の PAST_EVENTS に書いたものだけ。任意の過去は今までどおり受けない
  const inPastEvent = PAST_EVENTS.some((e) => endedAt.getTime() >= e.from && endedAt.getTime() <= e.to)
  if (!inPastEvent && Math.abs(now - endedAt.getTime()) > 24 * 60 * 60 * 1000) return json(request, { error: 'stale_time' }, 400)
  if (endedAt.getTime() > now + 60 * 60 * 1000) return json(request, { error: 'future_time' }, 400)

  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : ''
  // 記録した本人が、もとになったSNSの投稿URLを1つだけ添えられる（2026-09-25）。
  // AIの自動読み取り（sns-road-reports）が取りこぼした投稿を、市民が手で地図に足せるようにするため。
  // 検査は運営の編集と同じ normalizeRoadMediaUrls（http/https のみ・2048字まで）。不正なら記録ごと断る。
  const sourceUrlsRaw = body.sourceUrls === undefined || body.sourceUrls === null ? [] : body.sourceUrls
  const sourceUrls = normalizeRoadMediaUrls(Array.isArray(sourceUrlsRaw) ? sourceUrlsRaw : [sourceUrlsRaw])
  if (sourceUrls === null || sourceUrls.length > 1) return json(request, { error: 'invalid_source_url' }, 400)
  const hash = ipHash(request)

  // 同じ端末または同じ IP からの連続投稿を抑える（取消済みは再入力を妨げない）。
  // 運営が続けて記録するときは止めない（合言葉が正しい送信だけ）
  if (!isModerator(request)) {
    const since = new Date(now - MIN_INTERVAL_SECONDS * 1000).toISOString()
    const recentFilter = hash ? `device_id.eq.${deviceId},ip_hash.eq.${hash}` : `device_id.eq.${deviceId}`
    const { data: recent, error: recentError } = await supabase
      .from('disaster_passed_roads')
      .select('id, created_at')
      .eq('hidden', false)
      .or(recentFilter)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
    if (isMissingTable(recentError)) return json(request, { error: MIGRATION_HINT }, 503)
    if (recentError) return json(request, { error: recentError.message }, 500)
    if (recent?.length) {
      const latestAt = new Date(recent[0].created_at).getTime()
      const retryAfterSeconds = Number.isFinite(latestAt)
        ? Math.max(1, Math.min(MIN_INTERVAL_SECONDS, Math.ceil((latestAt + MIN_INTERVAL_SECONDS * 1000 - now) / 1000)))
        : MIN_INTERVAL_SECONDS
      return json(request, { error: 'too_frequent', retryAfterSeconds }, 429)
    }
  }

  // 記録時刻の雨量（取れなくても保存は続ける）。線のときは終点で判定
  const rain = await rainAt(path[path.length - 1], endedAt)

  const { data: inserted, error } = await supabase
    .from('disaster_passed_roads')
    .insert({
      device_id: deviceId,
      kind,
      source,
      path,
      rain_station: rain.station,
      rain_at: rain.at,
      rain_1h_mm: rain.r1h,
      rain_3h_mm: rain.r3h,
      rain_24h_mm: rain.r24h,
      rain_verdict: rain.verdict,
      point_count: path.length,
      length_m: Math.round(lengthM * 10) / 10,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      note,
      source_urls: sourceUrls,
      ip_hash: hash,
    })
    .select('id, created_at')
    .single()

  if (isMissingTable(error)) return json(request, { error: MIGRATION_HINT }, 503)
  if (error) return json(request, { error: error.message }, 500)

  return json(request, { ok: true, id: inserted?.id, kind, createdAt: inserted?.created_at, pointCount: path.length, lengthM: Math.round(lengthM), rain }, 201)
}

export async function DELETE(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id') ?? ''
  const deviceId = (searchParams.get('deviceId') ?? '').trim().slice(0, 64)
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(request, { error: 'invalid_id' }, 400)

  // 運営（いたずら対応）：合言葉が合っていれば、端末IDと10分の制限なしで伏せる／戻す。
  // 行は消さないので、繰り返すいたずらの端末はあとから追える
  if (searchParams.get('moderate') === '1') {
    if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
    const hide = searchParams.get('restore') !== '1'
    const { data: updated, error: modError } = await supabase
      .from('disaster_passed_roads')
      .update({ hidden: hide })
      .eq('id', id)
      .select('id, hidden')
    if (isMissingTable(modError)) return json(request, { error: MIGRATION_HINT }, 503)
    if (modError) return json(request, { error: modError.message }, 500)
    if (!updated?.length) return json(request, { error: 'not_found' }, 404)
    return json(request, { ok: true, id, hidden: hide, moderated: true })
  }

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return json(request, { error: 'invalid_device_id' }, 400)

  const { data: row, error: readError } = await supabase
    .from('disaster_passed_roads')
    .select('id, device_id, created_at, hidden')
    .eq('id', id)
    .maybeSingle()
  if (isMissingTable(readError)) return json(request, { error: MIGRATION_HINT }, 503)
  if (readError) return json(request, { error: readError.message }, 500)
  if (!row) return json(request, { error: 'not_found' }, 404)
  // 他人の記録は取り消せない。存在の有無も教えない
  if (row.device_id !== deviceId) return json(request, { error: 'not_found' }, 404)
  if (row.hidden) return json(request, { ok: true, alreadyHidden: true })
  const ageSeconds = (Date.now() - new Date(row.created_at as string).getTime()) / 1000
  if (ageSeconds > UNDO_WINDOW_SECONDS) return json(request, { error: 'too_late', undoWindowSeconds: UNDO_WINDOW_SECONDS }, 409)

  const { error } = await supabase.from('disaster_passed_roads').update({ hidden: true }).eq('id', id)
  if (error) return json(request, { error: error.message }, 500)
  return json(request, { ok: true, id })
}

// 運営が記録の時刻・メモを直す（2026-09-22）。道からずれた線を引き直すと、記録時刻が「引き直した時刻」になって
// 実際の時刻と食い違うため、合言葉つきで上書きできるようにする。時刻を変えたら、その時刻の雨量を取り直す
export async function PATCH(request: Request) {
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)

  const params = new URL(request.url).searchParams
  if (params.get('setting') === 'eventStart') {
    let payload: { eventStart?: unknown }
    try {
      payload = await request.json()
    } catch {
      return json(request, { error: 'invalid_json' }, 400)
    }
    const at = new Date(String(payload.eventStart ?? ''))
    if (Number.isNaN(at.getTime())) return json(request, { error: 'invalid_time' }, 400)
    if (at.getTime() > Date.now() + 24 * 60 * 60 * 1000) return json(request, { error: 'future_time' }, 400)
    const { error: saveError } = await supabase.from('app_settings').upsert({ key: EVENT_START_KEY, value: { at: at.toISOString() } })
    if (saveError) return json(request, { error: saveError.message }, 500)
    return json(request, { ok: true, eventStart: at.toISOString() })
  }

  const id = params.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(request, { error: 'invalid_id' }, 400)

  let body: { endedAt?: unknown; note?: unknown; imageUrls?: unknown; sourceUrls?: unknown; path?: unknown }
  try {
    body = await request.json()
  } catch {
    return json(request, { error: 'invalid_json' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(request, { error: 'invalid_json' }, 400)

  const update: Record<string, unknown> = {}
  if (typeof body.note === 'string') update.note = body.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE)
  // Missing fields preserve attachments; an explicit [] clears them.
  for (const [field, column] of [['imageUrls', 'image_urls'], ['sourceUrls', 'source_urls']] as const) {
    if (body[field] === undefined) continue
    const urls = normalizeRoadMediaUrls(body[field])
    if (!urls) return json(request, { error: `invalid_${column}`, hint: '最大3件の http(s) URL を指定してください。' }, 400)
    update[column] = urls
  }

  // 運営が線の点を動かして直す（2026-09-25 事業主指示B）。地点1点の記録も、点を道路上へ動かして直せるよう1点から受ける（同日追加）
  if (body.path !== undefined) {
    const path = normalizePath(body.path, 1)
    if (!path) return json(request, { error: 'invalid_path', hint: `1〜${MAX_POINTS}点の [緯度, 経度] 配列` }, 400)
    if (!path.some(insideInzai)) return json(request, { error: 'outside_inzai' }, 400)
    const lengthM = pathLengthM(path)
    if (lengthM > MAX_LENGTH_M) return json(request, { error: 'too_long', lengthM: Math.round(lengthM) }, 400)
    Object.assign(update, { path, point_count: path.length, length_m: Math.round(lengthM * 10) / 10 })
  }

  let rainOut: RainInfo | null = null
  if (body.endedAt !== undefined && body.endedAt !== null && body.endedAt !== '') {
    const at = new Date(String(body.endedAt))
    if (Number.isNaN(at.getTime())) return json(request, { error: 'invalid_time' }, 400)
    if (at.getTime() > Date.now() + 10 * 60 * 1000) return json(request, { error: 'future_time' }, 400)
    // 過去の日時は制限しない（2026-09-22）。みんつくの8月の豪雨の投稿などを運営が引き直し、当時の日時に戻すため。
    // 2000年より前だけは入力の誤りとして断る。気象庁の10分値は数日分しか残らないので、古い日時の雨量は「不明」になる
    if (at.getTime() < Date.UTC(2000, 0, 1)) return json(request, { error: 'invalid_time' }, 400)

    const { data: row, error: readError } = await supabase
      .from('disaster_passed_roads')
      .select('path, started_at, ended_at')
      .eq('id', id)
      .maybeSingle()
    if (isMissingTable(readError)) return json(request, { error: MIGRATION_HINT }, 503)
    if (readError) return json(request, { error: readError.message }, 500)
    if (!row) return json(request, { error: 'not_found' }, 404)

    // GPS の軌跡は所要時間を保つ（開始も同じだけずらす）
    const shift = at.getTime() - new Date(String(row.ended_at)).getTime()
    const started = new Date(new Date(String(row.started_at)).getTime() + (Number.isFinite(shift) ? shift : 0))
    const path = (update.path as LatLon[] | undefined) ?? (row.path as LatLon[])
    rainOut = await rainAt(path[path.length - 1], at)
    Object.assign(update, {
      started_at: (Number.isNaN(started.getTime()) ? at : started).toISOString(),
      ended_at: at.toISOString(),
      rain_station: rainOut.station,
      rain_at: rainOut.at,
      rain_1h_mm: rainOut.r1h,
      rain_3h_mm: rainOut.r3h,
      rain_24h_mm: rainOut.r24h,
      rain_verdict: rainOut.verdict,
    })
  }
  if (!Object.keys(update).length) return json(request, { error: 'nothing_to_update' }, 400)

  const { data: updated, error } = await supabase
    .from('disaster_passed_roads')
    .update(update)
    .eq('id', id)
    .select('id')
  if (isMissingTable(error)) return json(request, { error: MIGRATION_HINT }, 503)
  if (error) return json(request, { error: error.message }, 500)
  if (!updated?.length) return json(request, { error: 'not_found' }, 404)
  return json(request, { ok: true, id, endedAt: update.ended_at ?? null, note: update.note ?? null, rain: rainOut,
    ...(update.image_urls !== undefined ? { imageUrls: update.image_urls } : {}),
    ...(update.source_urls !== undefined ? { sourceUrls: update.source_urls } : {}),
    ...(update.path !== undefined ? { pointCount: update.point_count, lengthM: update.length_m } : {}),
  })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// 一般向けの GET は Vercel の配信側で 15 秒だけ保存して使い回す（2026-09-22）。保存中の応答は関数を呼ばないので、
// 閲覧者が増えても呼び出し回数（無料枠 月100万回）が増えない。台風の日に75%の警告が来たための対策。
// 運営の一覧（?all=1）や合言葉付きの呼び出し、エラーの応答は保存しない
export async function GET(request: Request) {
  const response = await getUncached(request)
  const url = new URL(request.url)
  if (response.status === 200 && !url.searchParams.has('all') && !request.headers.get('x-moderation-key')) {
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30')
  }
  return response
}
