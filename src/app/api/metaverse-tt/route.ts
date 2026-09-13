import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { verifyMetaverseToken, signMetaverseToken } from '@/lib/metaverse-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// メタバース印西 文化財タイムトライアル（厳密計測）
// クライアントは start / checkpoint / finish を都度POSTし、サーバー受信時刻で記録する。
// タイムは finished_at - started_at（サーバー時計）で確定するため、端末側の時計改ざんは効かない。
// ※移動そのものの不正（開発者ツールでのテレポート等）は通過間隔の妥当性チェックで flag を付けて検出補助する。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
])

const COURSES: Record<string, { checkpoints: number; minSecondsPerLeg: number; noQuiz?: boolean; loginRequired?: boolean; speedRank?: boolean }> = {
  // minSecondsPerLeg: 隣接チェックポイント間の物理的な最短所要秒（最高速度120m/s＋余裕から算出した下限）
  beginner: { checkpoints: 3, minSecondsPerLeg: 4 },
  intermediate: { checkpoints: 5, minSecondsPerLeg: 4 },
  advanced: { checkpoints: 7, minSecondsPerLeg: 4 },
  full: { checkpoints: 50, minSecondsPerLeg: 3 },
  // 夜景フライトモードの「いんザイ君ゲート10か所」コース（2026-09-04・イルミライ会場向け）。
  // 会場の来場者がその場で遊ぶため、クイズの参加要件は問わない（noQuiz）。ゲート間は約540m
  night: { checkpoints: 10, minSecondsPerLeg: 3, noQuiz: true, loginRequired: true },
  // 短縮コース（会場向け・5か所・約6km）
  night5: { checkpoints: 5, minSecondsPerLeg: 3, noQuiz: true, loginRequired: true },
  // 武蔵屋めぐり（2026-09-13・11/3 武蔵屋マルシェ会場）：白鳥の郷 → 千葉NT中央駅 → 武蔵屋4km圏の文化財3か所（毎回ランダム）→ 武蔵屋。
  // 毎回コースの長さが違うので、タイムではなく平均の速さ（コースの長さ ÷ タイム）で順位を付ける（speedRank）
  musashiya: { checkpoints: 5, minSecondsPerLeg: 3, noQuiz: true, loginRequired: true, speedRank: true },
}

// 武蔵屋めぐりの経路の検証と長さ。クライアントが送る経路（駅・文化財3か所・武蔵屋の緯度経度）を、
// 固定地点（駅・武蔵屋）との一致と、文化財が武蔵屋から4.2km以内であることで確かめ、白鳥の郷からの長さをサーバーで出す
const MSY_START = { lat: 35.813423, lon: 140.20665 } // 本埜の白鳥の郷
const MSY_STATION = { lat: 35.799983, lon: 140.116119 } // 千葉ニュータウン中央駅
const MSY_HOME = { lat: 35.840096, lon: 140.146774 } // 岩井家住宅主屋（旧武蔵屋店舗）
// 1人用の最高速＝飛行30m/s × 加速（RB/Shift）4 × ⚡速度切替4 ＝ 480m/s。これに余裕を足した値を超える平均は flag
// （2026-09-13 当初 130 にしていて、⚡×4 で飛んだ正当な記録（160m/s）を誤って除外した）
const MSY_MAX_SPEED_MPS = 520
type LatLon = { lat: number; lon: number }
function distM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
function checkMusashiyaRoute(raw: unknown): { routeM: number; route: Array<LatLon & { name: string }> } | null {
  if (!Array.isArray(raw) || raw.length !== 5) return null
  const pts = raw.map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon), name: String(p?.name ?? '').slice(0, 40) }))
  if (pts.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) return null
  if (distM(pts[0], MSY_STATION) > 300 || distM(pts[4], MSY_HOME) > 300) return null
  for (let i = 1; i <= 3; i++) if (distM(pts[i], MSY_HOME) > 4200) return null
  let m = distM(MSY_START, pts[0])
  for (let i = 1; i < pts.length; i++) m += distM(pts[i - 1], pts[i])
  return { routeM: Math.round(m), route: pts }
}
// 参加要件の既定値。app_settings（key: metaverse_tt_requirements）で
// イベントごとに上書きできる（管理画面 /admin/timetrial から変更）
const DEFAULT_MIN_QUIZ_RATE_PCT = 80
const DEFAULT_MIN_QUIZ_ANSWERS = 10
const RANKING_LIMIT = 10
const REQUIREMENTS_KEY = 'metaverse_tt_requirements'
// イベント期間（app_settings key: metaverse_tt_event）。管理画面 /admin/timetrial で設定する。
// 期間内はサイトのランキング既定が「イベント」になり、ゴール時にイベント内の順位も返す
const EVENT_KEY = 'metaverse_tt_event'

type Requirements = { minRatePct: number; minAnswers: number }
type TtEvent = { name: string; from: string; to: string; active: boolean }
type RankInfo = { rank: number; total: number }

async function loadEvent(supabase: NonNullable<ReturnType<typeof adminClient>>): Promise<TtEvent | null> {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', EVENT_KEY).maybeSingle()
    const v = (data?.value ?? {}) as Partial<TtEvent>
    const from = new Date(String(v.from ?? ''))
    const to = new Date(String(v.to ?? ''))
    if (!v.name || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
    const now = Date.now()
    return {
      name: String(v.name).slice(0, 40),
      from: from.toISOString(),
      to: to.toISOString(),
      active: now >= from.getTime() && now <= to.getTime(),
    }
  } catch {
    return null
  }
}

// 期間の指定 → finished_at の範囲。all=全期間、month=今月（JST）、week=直近7日、event=イベント期間、
// custom=from/to（ISO）。範囲が決められないときは全期間
function periodRange(period: string, from: string | null, to: string | null, event: TtEvent | null): { from?: string; to?: string } {
  const now = new Date()
  if (period === 'month') {
    // JST の月初を UTC に直す（JST = UTC+9）
    const jst = new Date(now.getTime() + 9 * 3600 * 1000)
    const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600 * 1000
    return { from: new Date(start).toISOString() }
  }
  if (period === 'today') {
    // JST の今日 0 時を UTC に直す
    const jst = new Date(now.getTime() + 9 * 3600 * 1000)
    const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600 * 1000
    return { from: new Date(start).toISOString() }
  }
  if (period === 'week') return { from: new Date(now.getTime() - 7 * 86400 * 1000).toISOString() }
  if (period === 'event' && event) return { from: event.from, to: event.to }
  if (period === 'custom') {
    const f = from ? new Date(from) : null
    const t = to ? new Date(to) : null
    const r: { from?: string; to?: string } = {}
    if (f && !Number.isNaN(f.getTime())) r.from = f.toISOString()
    if (t && !Number.isNaN(t.getTime())) r.to = t.toISOString()
    return r
  }
  return {}
}

// 人ごとのベストタイム（同じニックネームは1人とみなす）を集めて順位を出す。
// 「参加者のうち何位か」を答えるための集計なので、記録の件数ではなく人数で数える
async function rankAmongPeople(
  supabase: NonNullable<ReturnType<typeof adminClient>>,
  courseKey: string,
  range: { from?: string; to?: string },
  myName: string,
  myElapsedMs: number,
): Promise<RankInfo> {
  let q = supabase
    .from('metaverse_tt_trials')
    .select('name, elapsed_ms')
    .eq('course_key', courseKey)
    .eq('status', 'finished')
    .limit(5000)
  if (range.from) q = q.gte('finished_at', range.from)
  if (range.to) q = q.lte('finished_at', range.to)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const best = new Map<string, number>()
  for (const r of data ?? []) {
    const ms = Number(r.elapsed_ms)
    const prev = best.get(r.name)
    if (prev === undefined || ms < prev) best.set(r.name, ms)
  }
  let faster = 0
  for (const [name, ms] of best) if (name !== myName && ms < myElapsedMs) faster++
  const total = best.has(myName) ? best.size : best.size + 1
  return { rank: faster + 1, total }
}

// 速さで比べるコース（speedRank）：人ごとの最高の平均速度で順位を付ける
type SpeedRow = { name: string; elapsed_ms: number | string; route_m: number | string | null; finished_at?: string | null }
const speedOf = (r: SpeedRow) => {
  const ms = Number(r.elapsed_ms)
  const m = Number(r.route_m)
  return ms > 0 && m > 0 ? m / (ms / 1000) : 0
}
const kmh = (mps: number) => Math.round(mps * 3.6 * 10) / 10
async function loadSpeedRows(
  supabase: NonNullable<ReturnType<typeof adminClient>>,
  courseKey: string,
  range: { from?: string; to?: string },
): Promise<SpeedRow[]> {
  let q = supabase
    .from('metaverse_tt_trials')
    .select('name, elapsed_ms, route_m, finished_at')
    .eq('course_key', courseKey)
    .eq('status', 'finished')
    .limit(5000)
  if (range.from) q = q.gte('finished_at', range.from)
  if (range.to) q = q.lte('finished_at', range.to)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as SpeedRow[]
}
function bestSpeedByPerson(rows: SpeedRow[]): Map<string, SpeedRow> {
  const best = new Map<string, SpeedRow>()
  for (const r of rows) {
    const prev = best.get(r.name)
    if (!prev || speedOf(r) > speedOf(prev)) best.set(r.name, r)
  }
  return best
}
function speedRankOf(best: Map<string, SpeedRow>, myName: string, mySpeed: number): RankInfo {
  let faster = 0
  for (const [name, r] of best) if (name !== myName && speedOf(r) > mySpeed) faster++
  const total = best.has(myName) ? best.size : best.size + 1
  return { rank: faster + 1, total }
}

async function loadRequirements(supabase: NonNullable<ReturnType<typeof adminClient>>): Promise<Requirements> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', REQUIREMENTS_KEY)
      .maybeSingle()
    const v = (data?.value ?? {}) as Partial<Requirements>
    const minRatePct = Number(v.minRatePct)
    const minAnswers = Number(v.minAnswers)
    return {
      minRatePct: Number.isFinite(minRatePct) && minRatePct >= 0 && minRatePct <= 100 ? minRatePct : DEFAULT_MIN_QUIZ_RATE_PCT,
      minAnswers: Number.isFinite(minAnswers) && minAnswers >= 0 && minAnswers <= 500 ? minAnswers : DEFAULT_MIN_QUIZ_ANSWERS,
    }
  } catch {
    return { minRatePct: DEFAULT_MIN_QUIZ_RATE_PCT, minAnswers: DEFAULT_MIN_QUIZ_ANSWERS }
  }
}

function adminClient() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!supaUrl || !serviceKey) return null
  return createSupabaseClient(supaUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin)
      ? origin
      : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

function clientIp(h: Headers): string | null {
  const real = h.get('x-real-ip')?.trim()
  if (real) return real
  const first = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first || null
}

function recordCode(id: string): string {
  return id.replace(/-/g, '').slice(0, 10).toUpperCase()
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// GET : コースごとの上位記録（公開ランキング）
//   ?period=all|month|week|event|custom（&from=ISO&to=ISO）で期間を絞る。省略時は全期間。
//   応答の event に設定中のイベント期間（あれば）と active（期間内か）を含める
export async function GET(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  try {
    const url = new URL(request.url)
    const period = (url.searchParams.get('period') ?? 'all').toLowerCase()
    const [requirements, event] = await Promise.all([loadRequirements(supabase), loadEvent(supabase)])
    const range = periodRange(period, url.searchParams.get('from'), url.searchParams.get('to'), event)
    const ranking: Record<string, Array<{ name: string; elapsedMs: number; date: string; routeM?: number; speedKmh?: number }>> = {}
    for (const key of Object.keys(COURSES)) {
      if (COURSES[key].speedRank) {
        const best = bestSpeedByPerson(await loadSpeedRows(supabase, key, range))
        ranking[key] = [...best.values()]
          .sort((a, b) => speedOf(b) - speedOf(a))
          .slice(0, RANKING_LIMIT)
          .map((r) => ({
            name: r.name,
            elapsedMs: Number(r.elapsed_ms),
            date: String(r.finished_at ?? '').slice(0, 10),
            routeM: Number(r.route_m),
            speedKmh: kmh(speedOf(r)),
          }))
        continue
      }
      let q = supabase
        .from('metaverse_tt_trials')
        .select('name, elapsed_ms, finished_at')
        .eq('course_key', key)
        .eq('status', 'finished')
        .order('elapsed_ms', { ascending: true })
        .limit(RANKING_LIMIT * 5)
      if (range.from) q = q.gte('finished_at', range.from)
      if (range.to) q = q.lte('finished_at', range.to)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      // 同じ人（ニックネーム）はベストの1件だけ載せる
      const seen = new Set<string>()
      ranking[key] = (data ?? [])
        .filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)))
        .slice(0, RANKING_LIMIT)
        .map((r) => ({
          name: r.name,
          elapsedMs: Number(r.elapsed_ms),
          date: String(r.finished_at ?? '').slice(0, 10),
        }))
    }
    // ?name=ニックネーム が付いていれば、その人のコースごとの順位（同じ期間・人ごとのベストで比較）も返す。
    // 上位に入っていない人が「自分は何位か」をエントリー画面で確かめるため
    const myName = (url.searchParams.get('name') ?? '').trim().slice(0, 20)
    let myRank: Record<string, RankInfo & { bestMs: number; speedKmh?: number }> | null = null
    if (myName) {
      myRank = {}
      for (const key of Object.keys(COURSES)) {
        if (COURSES[key].speedRank) {
          const best = bestSpeedByPerson(await loadSpeedRows(supabase, key, range))
          const mine = best.get(myName)
          if (!mine) continue
          myRank[key] = { ...speedRankOf(best, myName, speedOf(mine)), bestMs: Number(mine.elapsed_ms), speedKmh: kmh(speedOf(mine)) }
          continue
        }
        let q = supabase
          .from('metaverse_tt_trials')
          .select('elapsed_ms')
          .eq('course_key', key)
          .eq('status', 'finished')
          .eq('name', myName)
          .order('elapsed_ms', { ascending: true })
          .limit(1)
        if (range.from) q = q.gte('finished_at', range.from)
        if (range.to) q = q.lte('finished_at', range.to)
        const { data: mine } = await q
        if (!mine || !mine.length) continue
        const bestMs = Number(mine[0].elapsed_ms)
        const r = await rankAmongPeople(supabase, key, range, myName, bestMs)
        myRank[key] = { ...r, bestMs }
      }
    }
    return json(request, { ranking, requirements, event, period, range, myRank })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-tt GET]', message)
    return json(request, { error: message }, 502)
  }
}

export async function POST(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json(request, { error: 'invalid json' }, 400)
  }
  const action = String(body.action ?? '')
  try {
    // 会場の共用PC向け：CiDAO の表示名（ニックネーム）を打ち込んで会員登録と照合し、参加トークンを発行する。
    // LINE ログインを来場者ごとに行うのが現実的でないため（2026-09-05 中司さん指示）。
    // 本人確認は表示名の一致のみ（会場ではスタッフが見ている前提）。有効期限は 12 時間
    if (action === 'claim') {
      // 会員証 QR（https://cidao.vercel.app/talent/<uuid> または UUID 単体）を会場PCのWebカメラで読んだ場合は uid で照合する。
      // UUID は推測できないので、表示名より確かな本人確認になる
      const qr = String(body.uid ?? body.qr ?? '').trim()
      const uidMatch = qr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (uidMatch) {
        const { data: m, error } = await supabase
          .from('members')
          .select('id, display_name, deleted_at')
          .eq('id', uidMatch[0].toLowerCase())
          .is('deleted_at', null)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!m) return json(request, { error: 'not found' }, 404)
        const nick = String(m.display_name).trim().slice(0, 20) || '名無しさん'
        const token = signMetaverseToken({ uid: m.id, nick, exp: Date.now() + 12 * 60 * 60 * 1000 })
        return json(request, { token, nick, via: 'qr' })
      }
      // 表示名の比較は両側を NFKC 正規化（全角英数・全角カッコ・空白の違いを吸収）して行う。
      // DB 側の値は正規化されていないので ilike では取りこぼす → 会員数は少ないため候補を取り出して JS で比較する
      const norm = (v: unknown) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
      const raw = norm(body.name).slice(0, 40)
      if (!raw) return json(request, { error: 'name required' }, 400)
      const { data: rows, error } = await supabase
        .from('members')
        .select('id, display_name')
        .is('deleted_at', null)
        .limit(5000)
      if (error) throw new Error(error.message)
      const exact = (rows ?? []).filter((r) => norm(r.display_name) === raw)
      if (exact.length === 0) return json(request, { error: 'not found' }, 404)
      // 表示名は一意制約が無い。同名が複数いるときは本人を特定できないので照合を断り、LINE ログインに回す
      if (exact.length > 1) return json(request, { error: 'ambiguous' }, 409)
      const hit = exact[0]
      const nick = String(hit.display_name).trim().slice(0, 20)
      const token = signMetaverseToken({ uid: hit.id, nick, exp: Date.now() + 12 * 60 * 60 * 1000 })
      return json(request, { token, nick, via: 'name' })
    }
    if (action === 'start') {
      let name = String(body.name ?? '').trim().slice(0, 20)
      const ageKey = String(body.ageKey ?? '').slice(0, 20)
      const courseKey = String(body.courseKey ?? '')
      const quizRatePct = Number(body.quizRatePct)
      const quizAnswers = Number(body.quizAnswers)
      const course = COURSES[courseKey]
      if (!course) return json(request, { error: 'invalid entry' }, 400)
      // CiDAO 登録者限定コース：/api/metaverse-auth が発行した署名トークンが必要。
      // 名前はクライアント申告ではなくログイン会員の表示名で固定する（ランキングはログインのニックネーム）
      if (course.loginRequired) {
        const login = verifyMetaverseToken(body.token)
        if (!login) return json(request, { error: 'login required' }, 401)
        name = login.nick.trim().slice(0, 20) || '名無しさん'
      }
      if (!name) return json(request, { error: 'invalid entry' }, 400)
      // 参加要件はサーバー側でも下限を確認する（クライアント申告値ベース・要件は設定から読む）
      if (!course.noQuiz) {
        const req = await loadRequirements(supabase)
        if (!(quizRatePct >= req.minRatePct) || !(quizAnswers >= req.minAnswers)) {
          return json(request, { error: 'quiz requirement not met' }, 403)
        }
      }
      // 速さで比べるコースは、経路を検証してサーバー側でコースの長さを確定する（クライアント申告の長さは使わない）
      let routeInfo: ReturnType<typeof checkMusashiyaRoute> = null
      if (course.speedRank) {
        routeInfo = checkMusashiyaRoute(body.route)
        if (!routeInfo) return json(request, { error: 'invalid route' }, 400)
      }
      const { data, error } = await supabase
        .from('metaverse_tt_trials')
        .insert({
          name,
          age_key: ageKey,
          course_key: courseKey,
          checkpoints_total: course.checkpoints,
          quiz_rate_pct: Number.isFinite(quizRatePct) ? Math.round(quizRatePct) : 0,
          quiz_answers: Number.isFinite(quizAnswers) ? Math.round(quizAnswers) : 0,
          client_ip: clientIp(request.headers),
          ...(routeInfo ? { route_m: routeInfo.routeM, route: routeInfo.route } : {}),
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return json(request, { trialId: data.id, routeM: routeInfo?.routeM ?? null })
    }

    if (action === 'checkpoint') {
      const trialId = String(body.trialId ?? '')
      const pos = Number(body.pos)
      if (!trialId || !Number.isInteger(pos)) return json(request, { error: 'invalid checkpoint' }, 400)
      const { data: trial, error } = await supabase
        .from('metaverse_tt_trials')
        .select('id, status, checkpoints_total, checkpoints_passed, started_at, last_checkpoint_at, flags, course_key')
        .eq('id', trialId)
        .maybeSingle()
      // DB の一時的なエラーは 502（クライアントがやり直す）。本当に無いときだけ 404
      if (error) throw new Error(error.message)
      if (!trial) return json(request, { error: 'trial not found' }, 404)
      if (trial.status !== 'running') return json(request, { error: 'trial not running' }, 409)
      // 同じ地点の再送（通信の失敗でクライアントがやり直した）は受け流す。順番違いの flag を付けない
      if (pos > 0 && pos === trial.checkpoints_passed) return json(request, { ok: true, passed: pos, duplicate: true })
      const flags: string[] = Array.isArray(trial.flags) ? trial.flags : []
      if (pos !== trial.checkpoints_passed + 1 || pos > trial.checkpoints_total) {
        flags.push(`order:${trial.checkpoints_passed}->${pos}`)
        await supabase.from('metaverse_tt_trials').update({ flags }).eq('id', trialId)
        return json(request, { error: 'checkpoint out of order' }, 409)
      }
      // 物理的にあり得ない速さの通過は flag（最高速度から算出した下限秒より短い間隔）
      const prev = trial.last_checkpoint_at ?? trial.started_at
      const gapSec = (Date.now() - new Date(prev as string).getTime()) / 1000
      const minLeg = COURSES[trial.course_key as string]?.minSecondsPerLeg ?? 3
      if (pos > 1 && gapSec < minLeg) flags.push(`fast-leg:${pos}:${gapSec.toFixed(1)}s`)
      const { error: upErr } = await supabase
        .from('metaverse_tt_trials')
        .update({ checkpoints_passed: pos, last_checkpoint_at: new Date().toISOString(), flags })
        .eq('id', trialId)
      if (upErr) throw new Error(upErr.message)
      return json(request, { ok: true, passed: pos })
    }

    if (action === 'finish') {
      const trialId = String(body.trialId ?? '')
      if (!trialId) return json(request, { error: 'invalid finish' }, 400)
      const { data: trial, error } = await supabase
        .from('metaverse_tt_trials')
        .select('id, status, checkpoints_total, checkpoints_passed, started_at, flags, course_key, name, route_m, elapsed_ms, record_code')
        .eq('id', trialId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!trial) return json(request, { error: 'trial not found' }, 404)
      // ゴールの再送（前回の応答が届かなかった）は、確定済みの結果をそのまま返す
      if ((trial.status === 'finished' || trial.status === 'flagged') && trial.elapsed_ms != null) {
        const rm = Number(trial.route_m)
        const em = Number(trial.elapsed_ms)
        return json(request, {
          elapsedMs: em, recordCode: trial.record_code, flagged: trial.status === 'flagged', rank: null,
          routeM: rm > 0 ? rm : null, speedKmh: rm > 0 && em > 0 ? kmh(rm / (em / 1000)) : null, duplicate: true,
        })
      }
      if (trial.status !== 'running') return json(request, { error: 'trial not running' }, 409)
      if (trial.checkpoints_passed !== trial.checkpoints_total) {
        return json(request, { error: 'not all checkpoints passed' }, 409)
      }
      const finishedAt = new Date()
      const elapsedMs = finishedAt.getTime() - new Date(trial.started_at as string).getTime()
      const flags: string[] = Array.isArray(trial.flags) ? trial.flags : []
      // 速さで比べるコース：平均速度（経路の長さ ÷ サーバー計測のタイム）。物理的にあり得ない速さは flag
      const routeM = Number(trial.route_m)
      const speedMps = COURSES[String(trial.course_key)]?.speedRank && routeM > 0 ? routeM / (elapsedMs / 1000) : null
      if (speedMps !== null && speedMps > MSY_MAX_SPEED_MPS) flags.push(`too-fast:${speedMps.toFixed(0)}mps`)
      const status = flags.length ? 'flagged' : 'finished'
      const code = recordCode(String(trial.id))
      const { error: upErr } = await supabase
        .from('metaverse_tt_trials')
        .update({
          finished_at: finishedAt.toISOString(),
          elapsed_ms: elapsedMs,
          record_code: code,
          status,
          flags,
        })
        .eq('id', trialId)
      if (upErr) throw new Error(upErr.message)
      // 参加者のうち何位か（人ごとのベストで数える）。全期間・今月・イベント期間（設定中なら）
      let rank: Record<string, RankInfo | (RankInfo & { name: string })> | null = null
      if (status === 'finished') {
        try {
          const courseKey = String(trial.course_key)
          const event = await loadEvent(supabase)
          if (speedMps !== null) {
            const [allRows, todayRows] = await Promise.all([
              loadSpeedRows(supabase, courseKey, {}),
              loadSpeedRows(supabase, courseKey, periodRange('today', null, null, null)),
            ])
            rank = {
              all: speedRankOf(bestSpeedByPerson(allRows), trial.name, speedMps),
              today: speedRankOf(bestSpeedByPerson(todayRows), trial.name, speedMps),
            }
            if (event?.active) {
              const evRows = await loadSpeedRows(supabase, courseKey, { from: event.from, to: event.to })
              rank.event = { ...speedRankOf(bestSpeedByPerson(evRows), trial.name, speedMps), name: event.name }
            }
          } else {
            const [all, month] = await Promise.all([
              rankAmongPeople(supabase, courseKey, {}, trial.name, elapsedMs),
              rankAmongPeople(supabase, courseKey, periodRange('month', null, null, null), trial.name, elapsedMs),
            ])
            rank = { all, month }
            if (event?.active) {
              const ev = await rankAmongPeople(supabase, courseKey, { from: event.from, to: event.to }, trial.name, elapsedMs)
              rank.event = { ...ev, name: event.name }
            }
          }
        } catch (e) {
          console.error('[metaverse-tt finish rank]', e instanceof Error ? e.message : String(e))
        }
      }
      return json(request, {
        elapsedMs,
        recordCode: code,
        flagged: status === 'flagged',
        rank,
        routeM: routeM > 0 ? routeM : null,
        speedKmh: speedMps !== null ? kmh(speedMps) : null,
      })
    }

    return json(request, { error: 'unknown action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-tt POST]', message)
    return json(request, { error: message }, 502)
  }
}
