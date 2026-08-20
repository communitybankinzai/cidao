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

const COURSES: Record<string, { checkpoints: number; minSecondsPerLeg: number }> = {
  // minSecondsPerLeg: 隣接チェックポイント間の物理的な最短所要秒（最高速度120m/s＋余裕から算出した下限）
  beginner: { checkpoints: 3, minSecondsPerLeg: 4 },
  intermediate: { checkpoints: 5, minSecondsPerLeg: 4 },
  advanced: { checkpoints: 7, minSecondsPerLeg: 4 },
  full: { checkpoints: 50, minSecondsPerLeg: 3 },
}
// 参加要件の既定値。app_settings（key: metaverse_tt_requirements）で
// イベントごとに上書きできる（管理画面 /admin/timetrial から変更）
const DEFAULT_MIN_QUIZ_RATE_PCT = 80
const DEFAULT_MIN_QUIZ_ANSWERS = 10
const RANKING_LIMIT = 10
const REQUIREMENTS_KEY = 'metaverse_tt_requirements'

type Requirements = { minRatePct: number; minAnswers: number }

async function loadRequirements(supabase: ReturnType<typeof createSupabaseClient>): Promise<Requirements> {
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

// GET ?action=ranking : コースごとの上位記録（公開ランキング）
export async function GET(request: Request) {
  const supabase = adminClient()
  if (!supabase) return json(request, { error: 'server not configured' }, 503)
  try {
    const requirements = await loadRequirements(supabase)
    const ranking: Record<string, Array<{ name: string; elapsedMs: number; date: string }>> = {}
    for (const key of Object.keys(COURSES)) {
      const { data, error } = await supabase
        .from('metaverse_tt_trials')
        .select('name, elapsed_ms, finished_at')
        .eq('course_key', key)
        .eq('status', 'finished')
        .order('elapsed_ms', { ascending: true })
        .limit(RANKING_LIMIT)
      if (error) throw new Error(error.message)
      ranking[key] = (data ?? []).map((r) => ({
        name: r.name,
        elapsedMs: Number(r.elapsed_ms),
        date: String(r.finished_at ?? '').slice(0, 10),
      }))
    }
    return json(request, { ranking, requirements })
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
      const req = await loadRequirements(supabase)
      if (!(quizRatePct >= req.minRatePct) || !(quizAnswers >= req.minAnswers)) {
        return json(request, { error: 'quiz requirement not met' }, 403)
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
        .select('id, status, checkpoints_total, checkpoints_passed, started_at, flags')
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
      return json(request, { elapsedMs, recordCode: code, flagged: status === 'flagged' })
    }

    return json(request, { error: 'unknown action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[metaverse-tt POST]', message)
    return json(request, { error: message }, 502)
  }
}
