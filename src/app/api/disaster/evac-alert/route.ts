// 印西市防災速報から「市の避難情報」（高齢者等避難・避難指示・緊急安全確保）を拾い、
// 防災MAPの地図上の警告帯に出すための API（2026-09-21）。
//
// - GET: 発令中の避難情報を新しい順に返す。解除の放送・発表から24時間経過で外す。
// - POST（運営のみ）: いま出ている放送を全員の画面から消す／戻す。
//   消すのは「その放送（publishedAt）」だけ。新しい放送が出れば自動で再び出る。
//   合言葉は冠水・通れた道 API と同じ DISASTER_MODERATION_KEY。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { CITY_PORTAL_URL, fetchOfficialUpdates } from '@/lib/inzai-city-alerts'
import { detectEvacAlerts, type EvacAlert } from '@/lib/inzai-evac-alert'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OFF_KEY = 'evac_alert_off'

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://127.0.0.1:8766',
  'http://localhost:8791',
  'http://localhost:8792',
  'http://localhost:8793',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
    'Cache-Control': 'no-store',
  }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
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

function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY || process.env.CRON_SECRET || ''
  if (!key) return false
  const given = request.headers.get('x-moderation-key') ?? ''
  return given.length >= 16 && given === key
}

// 運営が消した放送（publishedAt の並び）。放送ごとに消す／戻す
type OffEntry = { publishedAt: string; offAt: string }

async function readOff(): Promise<OffEntry[]> {
  const supabase = serviceClient()
  if (!supabase) return []
  const { data } = await supabase.from('app_settings').select('value').eq('key', OFF_KEY).maybeSingle()
  const list = (data?.value as { entries?: OffEntry[] } | undefined)?.entries
  return Array.isArray(list) ? list.filter((e) => typeof e?.publishedAt === 'string') : []
}

// 【放送が消えたときのために覚えておく（2026-09-24）】
// 市の防災速報（get_bousai_xml.php）は災害が落ち着くと {"fname":0}＝0件になる。
// 発令中でも0件になるため、そのままだと「解除されたから消えた」のか「データが消えたから消えた」のか
// 区別できないまま帯が消える（9/24 朝に実際に起きた。県のまとめには閉鎖の発表が無かった）。
// 直前の判定を app_settings に覚えておき、0件のときは stale: true を付けて返す。24時間で消えるのは従来どおり。
const LAST_KEY = 'evac_alert_last'
type LastState = { alerts: EvacAlert[]; lastBroadcastAt: string; savedAt: string }

async function readLast(): Promise<LastState | null> {
  const supabase = serviceClient()
  if (!supabase) return null
  const { data } = await supabase.from('app_settings').select('value').eq('key', LAST_KEY).maybeSingle()
  const v = data?.value as LastState | undefined
  return v && Array.isArray(v.alerts) ? v : null
}

async function writeLast(state: LastState) {
  const supabase = serviceClient()
  if (!supabase) return
  const { error } = await supabase.from('app_settings').upsert({ key: LAST_KEY, value: state })
  if (error) console.error('[disaster/evac-alert] last', error.message)
}

async function getUncached(request: Request) {
  try {
    const [updates, off, last] = await Promise.all([fetchOfficialUpdates(), readOff(), readLast()])
    const now = Date.now()
    let { alerts, reason } = detectEvacAlerts(updates, now)
    let stale = false
    let lastBroadcastAt = updates.length ? (updates[0]?.publishedAt ?? '') : (last?.lastBroadcastAt ?? '')

    if (updates.length) {
      // 放送が読めたときの判定が正。次に0件になったときのために覚えておく
      const latest = updates.map((u) => u.publishedAt).sort().pop() ?? ''
      lastBroadcastAt = latest
      if (alerts.length || last?.alerts?.length) {
        await writeLast({ alerts, lastBroadcastAt: latest, savedAt: new Date().toISOString() })
      }
    } else if (last?.alerts?.length) {
      // 放送が0件。覚えていた発令を「参考」として返す（24時間を過ぎたものは detect と同じ基準で落とす）
      const kept = detectEvacAlerts(
        last.alerts.map((a) => ({ title: a.title, message: a.message, publishedAt: a.publishedAt, sourceUrl: a.sourceUrl })),
        now,
      )
      alerts = kept.alerts
      reason = alerts.length ? 'stale' : kept.reason
      stale = alerts.length > 0
    }

    const offSet = new Set(off.map((e) => e.publishedAt))
    return json(request, {
      fetchedAt: new Date().toISOString(),
      alerts: alerts.map((a) => ({ ...a, suppressed: offSet.has(a.publishedAt) })),
      reason,
      // true＝市の放送データが空になったため、直前の発令をそのまま出している（解除を確認したわけではない）
      stale,
      lastBroadcastAt,
      source: { name: '印西市防災速報', url: CITY_PORTAL_URL },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/evac-alert]', message)
    return json(request, { error: message }, 502)
  }
}

// 本文 { off: true|false, publishedAt } で、その放送を消す／戻す
export async function POST(request: Request) {
  if (!isModerator(request)) return json(request, { error: 'forbidden' }, 403)
  const supabase = serviceClient()
  if (!supabase) return json(request, { error: 'server_not_configured' }, 503)
  const body = (await request.json().catch(() => ({}))) as { off?: boolean; publishedAt?: string }
  const publishedAt = String(body.publishedAt ?? '').slice(0, 40)
  if (!publishedAt) return json(request, { error: 'publishedAt_required' }, 400)
  const current = await readOff()
  // 古い記録は48時間で捨てる（放送は24時間で帯から消えるので、それ以上持つ意味がない）
  const recent = current.filter((e) => e.publishedAt !== publishedAt && Date.now() - Date.parse(e.offAt) < 48 * 3600_000)
  const entries = body.off ? [...recent, { publishedAt, offAt: new Date().toISOString() }] : recent
  const { error } = await supabase.from('app_settings').upsert({ key: OFF_KEY, value: { entries } })
  if (error) return json(request, { error: error.message }, 500)
  return json(request, { ok: true, publishedAt, off: !!body.off })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// 一般向けの GET は Vercel の配信側で 60 秒だけ保存して使い回す（2026-09-22）。保存中の応答は関数を呼ばないので、
// 閲覧者が増えても呼び出し回数（無料枠 月100万回）が増えない。台風の日に75%の警告が来たための対策。
// 運営の一覧（?all=1）や合言葉付きの呼び出し、エラーの応答は保存しない
export async function GET(request: Request) {
  const response = await getUncached(request)
  const url = new URL(request.url)
  if (response.status === 200 && !url.searchParams.has('all') && !request.headers.get('x-moderation-key')) {
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120')
  }
  return response
}
