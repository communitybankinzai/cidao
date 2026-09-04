import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

const COURSES: Record<string, { checkpoints: number; minSecondsPerLeg: number; noQuiz?: boolean }> = {
  // minSecondsPerLeg: 隣接チェックポイント間の物理的な最短所要秒（最高速度120m/s＋余裕から算出した下限）
  beginner: { checkpoints: 3, minSecondsPerLeg: 4 },
  intermediate: { checkpoints: 5, minSecondsPerLeg: 4 },
  advanced: { checkpoints: 7, minSecondsPerLeg: 4 },
  full: { checkpoints: 50, minSecondsPerLeg: 3 },
  // 夜景フライトモードの「いんザイ君ゲート10か所」コース（2026-09-04・イルミライ会場向け）。
  // 会場の来場者がその場で遊ぶため、クイズの参加要件は問わない（noQuiz）。ゲート間は約540m
  night: { checkpoints: 10, minSecondsPerLeg: 3, noQuiz: true },
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
    const ranking: Record<string, Array<{ name: string; elapsedMs: number; date: string }>> = {}
    for (const key of Object.keys(COURSES)) {
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
    let myRank: Record<string, RankInfo & { bestMs: number }> | null = null
    if (myName) {
      myRank = {}
      for (const key of Object.keys(COURSES)) {
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
    if (action === 'start') {
      const name = String(body.name ?? '').trim().slice(0, 20)
      const ageKey = String(body.ageKey ?? '').slice(0, 20)
      const courseKey = String(body.courseKey ?? '')
      const quizRatePct = Number(body.quizRatePct)
      const quizAnswers = Number(body.quizAnswers)
      const course = COURSES[courseKey]
      if (!name || !course) return json(request, { error: 'invalid entry' }, 400)
      // 参加要件はサーバー側でも下限を確認する（クライアント申告値ベース・要件は設定から読む）
      if (!course.noQuiz) {
        const req = await loadRequirements(supabase)
        if (!(quizRatePct >= req.minRatePct) || !(quizAnswers >= req.minAnswers)) {
          return json(request, { error: 'quiz requirement not met' }, 403)
        }
      }
      const { data, error } = await supabase
        .from('metaverse_tt_trials')
        .insert({
          name,
          age_key: ageKey,
          course_key: courseKey,
          checkpoints_total: course.checkpoints,
          quiz_rate_pct: Math.round(quizRatePct),
          quiz_answers: Math.round(quizAnswers),
          client_ip: clientIp(request.headers),
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return json(request, { trialId: data.id })
    }

    if (action === 'checkpoint') {
      const trialId = String(body.trialId ?? '')
      const pos = Number(body.pos)
      if (!trialId || !Number.isInteger(pos)) return json(request, { error: 'invalid checkpoint' }, 400)
      const { data: trial, error } = await supabase
        .from('metaverse_tt_trials')
        .select('id, status, checkpoints_total, checkpoints_passed, started_at, last_checkpoint_at, flags, course_key')
        .eq('id', trialId)
        .single()
      if (error || !trial) return json(request, { error: 'trial not found' }, 404)
      if (trial.status !== 'running') return json(request, { error: 'trial not running' }, 409)
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
        .select('id, status, checkpoints_total, checkpoints_passed, started_at, flags, course_key, name')
        .eq('id', trialId)
        .single()
      if (error || !trial) return json(request, { error: 'trial not found' }, 404)
      if (trial.status !== 'running') return json(request, { error: 'trial not running' }, 409)
      if (trial.checkpoints_passed !== trial.checkpoints_total) {
        return json(request, { error: 'not all checkpoints passed' }, 409)
      }
      const finishedAt = new Date()
      const elapsedMs = finishedAt.getTime() - new Date(trial.started_at as string).getTime()
      const flags: string[] = Array.isArray(trial.flags) ? trial.flags : []
      const status = flags.length ? 'flagged' : 'finished'
      const code = recordCode(String(trial.id))
      const { error: upErr } = await supabase
        .from('metaverse_tt_trials')
        .update({
          finished_at: finishedAt.toISOString(),
          elapsed_ms: elapsedMs,
          record_code: code,
          status,
        })
        .eq('id', trialId)
      if (upErr) throw new Error(upErr.message)
      // 参加者のうち何位か（人ごとのベストで数える）。全期間・今月・イベント期間（設定中なら）
      let rank: Record<string, RankInfo | (RankInfo & { name: string })> | null = null
      if (status === 'finished') {
        try {
          const courseKey = String(trial.course_key)
          const event = await loadEvent(supabase)
          const [all, month] = await Promise.all([
            rankAmongPeople(supabase, courseKey, {}, trial.name, elapsedMs),
            rankAmongPeople(supabase, courseKey, periodRange('month', null, null, null), trial.name, elapsedMs),
          ])
          rank = { all, month }
          if (event?.active) {
            const ev = await rankAmongPeople(supabase, courseKey, { from: event.from, to: event.to }, trial.name, elapsedMs)
            rank.event = { ...ev, name: event.name }
          }
        } catch (e) {
          console.error('[metaverse-tt finish rank]', e instanceof Error ? e.message : String(e))
        }
      }
      return json(request, { elapsedMs, recordCode: code, flagged: status === 'flagged', rank })
    }

    return json(request, { error: 'unknown action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-tt POST]', message)
    return json(request, { error: message }, 502)
  }
}
