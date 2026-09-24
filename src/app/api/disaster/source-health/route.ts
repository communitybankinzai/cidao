// 防災MAPが使っている情報源の「鮮度」を1か所にまとめて返す（2026-09-24）。
//
// なぜ要るか：2026-09-24 に、古いデータが古いと気づかれないまま使われる事故が2件続いた。
//   1. みんつく千葉冠水マップの取り込みが 9/21 07:20 生成のまま3日間止まり、
//      台風25号の後半の2,652件が地図に出ていなかった（誰も気づけなかった）。
//   2. 市が 18:50 に放送した避難指示の解除を取りこぼし、解除後もレベル4と判定して
//      自動SNS投稿がレベル4を出した。
// どちらも「止まっている」だけでなく「古い判断が生き続けている」形だったので、
// この API は**最終更新からの経過**と**その判断が何時間前のものか**の両方を返す。
//
// ⚠ Supabase を読むだけにする。新しい pg_cron や定期実行は作らない
//    （Vercel の Fluid Active CPU 無料枠が逼迫しているため）。
// ⚠ みんつくの生成時刻だけは外から取るが、kansui と**同じURL・同じ10分の鍵**で読むので、
//    Next のデータキャッシュが共有され、先方への取得は増えない。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const KANSUI_SOURCE_URL = 'https://mintsuku-chiba-kansuimap.com/data/hazard_reports.json'
const KANSUI_CACHE_SECONDS = 600

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://127.0.0.1:8766',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-moderation-key',
  }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function isModerator(request: Request) {
  const key = process.env.DISASTER_MODERATION_KEY ?? ''
  return Boolean(key) && request.headers.get('x-moderation-key') === key
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Row = {
  /** 画面での並び順のまとまり */
  group: string
  label: string
  /** 最後に新しくなった時刻（ISO）。取れなければ null */
  lastAt: string | null
  /** 最後に新しくなってから何分たったか */
  ageMinutes: number | null
  /** このくらいの間隔で新しくなるはず、という目安（分） */
  expectMinutes: number | null
  /** ok=正常／late=遅れている／danger=止まっている疑い／unknown=測れない */
  level: 'ok' | 'late' | 'danger' | 'unknown'
  /** 補足（何件ある、どこまで発表が出ている、等） */
  detail: string
  /** 「その判断が何時間前のものか」。古い判断が生き続けていないかを見るための欄 */
  judgedAgeText?: string
}

function minutesSince(value: string | null | undefined) {
  if (!value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return Math.round((Date.now() - ms) / 60000)
}

function levelOf(ageMinutes: number | null, expectMinutes: number | null): Row['level'] {
  if (ageMinutes === null) return 'unknown'
  if (expectMinutes === null) return 'ok'
  if (ageMinutes > expectMinutes * 3) return 'danger'
  if (ageMinutes > expectMinutes) return 'late'
  return 'ok'
}

function hoursText(minutes: number | null) {
  if (minutes === null) return '不明'
  if (minutes < 60) return `${minutes}分前`
  if (minutes < 60 * 48) return `${Math.floor(minutes / 60)}時間前`
  return `${Math.floor(minutes / 1440)}日前`
}

/** みんつくの本家が、いつ作ったデータを配っているか */
async function kansuiGeneratedAt() {
  try {
    // kansui の route.ts と同じ鍵。10分に1回しか先方へ行かない（キャッシュを共有する）
    const bucket = Math.floor(Date.now() / (KANSUI_CACHE_SECONDS * 1000))
    const response = await fetch(`${KANSUI_SOURCE_URL}?cbi=${bucket}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
      next: { revalidate: KANSUI_CACHE_SECONDS },
    })
    if (!response.ok) return { at: null as string | null, count: null as number | null }
    const payload = (await response.json()) as { generated_at?: string; roads?: unknown[] }
    return { at: payload.generated_at ?? null, count: Array.isArray(payload.roads) ? payload.roads.length : null }
  } catch {
    return { at: null as string | null, count: null as number | null }
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request: Request) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'public, max-age=0, s-maxage=60' }
  const supabase = serviceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers })
  }
  const showErrors = isModerator(request)
  const rows: Row[] = []

  const settingsKeys = ['evac_alert_last', 'shelter_last_open', 'disaster_timeline_state', 'disaster_sns_monitor_state']
  const [
    kansui,
    settings,
    river,
    timeline,
    infoSources,
    snsRun,
    closures,
    closureFetches,
    citizen,
  ] = await Promise.all([
    kansuiGeneratedAt(),
    supabase.from('app_settings').select('key, value').in('key', settingsKeys),
    supabase.from('disaster_river_levels').select('observed_at').order('observed_at', { ascending: false }).limit(1),
    supabase.from('disaster_timeline_items').select('occurred_at').order('occurred_at', { ascending: false }).limit(1),
    supabase.from('disaster_info_sources').select('label, kind, enabled, last_fetched_at, last_status, last_error').eq('enabled', true),
    supabase.from('disaster_sns_scan_runs').select('finished_at, status, discovered_count').order('started_at', { ascending: false }).limit(1),
    supabase.from('disaster_road_closures').select('published_at, last_seen_at').is('cleared_at', null).order('published_at', { ascending: true }),
    supabase.from('app_settings').select('key, value').like('key', 'road_closure_last_fetch:%'),
    supabase.from('disaster_passed_roads').select('created_at').order('created_at', { ascending: false }).limit(1),
  ])

  const setting = (key: string) => (settings.data ?? []).find((r) => r.key === key)?.value as Record<string, unknown> | undefined

  // 1. みんつくの冠水（市民の投稿）
  {
    const age = minutesSince(kansui.at)
    rows.push({
      group: '外から取り込むもの',
      label: 'みんつくの冠水（市民の投稿）',
      lastAt: kansui.at,
      ageMinutes: age,
      expectMinutes: 60,
      level: levelOf(age, 60),
      detail: kansui.count === null ? '本家から取得できませんでした' : `本家が配っているのは ${kansui.count.toLocaleString()} 件`,
    })
  }

  // 2. 沼・川の水位（MAPが開かれたときだけ貯まる）
  {
    const at = river.data?.[0]?.observed_at ?? null
    const age = minutesSince(at)
    rows.push({
      group: '外から取り込むもの',
      label: '沼・川の水位（10分値）',
      lastAt: at,
      ageMinutes: age,
      expectMinutes: 360,
      level: levelOf(age, 360),
      detail: '防災MAPが開かれたときだけ貯まるので、誰も見ていない時間は空きます',
    })
  }

  // 3. 市の避難情報（止まっていないかと、発令が古くないかの両方を見る）
  {
    const last = setting('evac_alert_last') ?? {}
    const lastBroadcastAt = typeof last.lastBroadcastAt === 'string' ? last.lastBroadcastAt : null
    const savedAt = typeof last.savedAt === 'string' ? last.savedAt : null
    const alerts = Array.isArray(last.alerts) ? (last.alerts as Array<{ publishedAt?: string; label?: string }>) : []
    const age = minutesSince(savedAt)
    // 発令中のうち、いちばん古いものが何時間前か
    let oldest: number | null = null
    for (const a of alerts) {
      const m = typeof a.publishedAt === 'string' ? minutesSince(a.publishedAt.replace(/\//g, '-').replace(' ', 'T') + '+09:00') : null
      if (m !== null && (oldest === null || m > oldest)) oldest = m
    }
    const staleAlert = oldest !== null && oldest > 24 * 60
    rows.push({
      group: '市の発表',
      label: '市の避難情報（発令・解除）',
      lastAt: savedAt,
      ageMinutes: age,
      expectMinutes: 180,
      level: staleAlert ? 'danger' : levelOf(age, 180),
      detail: alerts.length
        ? `発令中 ${alerts.length}件${lastBroadcastAt ? `／最後の放送 ${lastBroadcastAt}` : ''}`
        : `発令なし${lastBroadcastAt ? `／最後の放送 ${lastBroadcastAt}` : ''}`,
      judgedAgeText: alerts.length
        ? `いちばん古い発令は ${hoursText(oldest)}${staleAlert ? '（24時間を超えています）' : ''}`
        : '—',
    })
  }

  // 4. 避難所の開設
  {
    const last = setting('shelter_last_open') ?? {}
    const savedAt = typeof last.savedAt === 'string' ? last.savedAt : null
    const open = Array.isArray(last.names) ? last.names.length : Array.isArray(last.open) ? (last.open as unknown[]).length : null
    const age = minutesSince(savedAt)
    rows.push({
      group: '市の発表',
      label: '避難所の開設',
      lastAt: savedAt,
      ageMinutes: age,
      expectMinutes: 360,
      level: levelOf(age, 360),
      detail: open === null ? '直前の判定は保存されていません' : `直前に開設中と判定した施設 ${open}件`,
    })
  }

  // 5. 公式発表の巡回（情報源ごと）
  {
    const sources = (infoSources.data ?? []) as Array<{ label: string; kind: string; last_fetched_at: string | null; last_status: string | null; last_error: string | null }>
    const newest = timeline.data?.[0]?.occurred_at ?? null
    const stale = sources.filter((s) => {
      const m = minutesSince(s.last_fetched_at)
      return m === null || m > 180
    })
    const failed = sources.filter((s) => s.last_status && s.last_status !== 'ok' && s.last_status !== 'success')
    const ages = sources.map((s) => minutesSince(s.last_fetched_at)).filter((x): x is number => x !== null)
    const age = ages.length ? Math.min(...ages) : null
    rows.push({
      group: '市の発表',
      label: `公式発表の巡回（情報源 ${sources.length}件）`,
      lastAt: null,
      ageMinutes: age,
      expectMinutes: 120,
      level: stale.length ? (stale.length === sources.length ? 'danger' : 'late') : levelOf(age, 120),
      detail: `3時間以上取れていない情報源 ${stale.length}件${failed.length ? `／前回失敗 ${failed.length}件` : ''}`
        + (showErrors && failed.length ? `：${failed.map((s) => `${s.label}（${s.last_error ?? s.last_status}）`).join('、')}` : ''),
      judgedAgeText: newest ? `いちばん新しい発表は ${hoursText(minutesSince(newest))}` : '—',
    })
  }

  // 6. 役所の通行止め
  {
    const fetches = (closureFetches.data ?? []).map((r) => minutesSince(typeof r.value === 'string' ? r.value : (r.value as { at?: string } | null)?.at ?? null))
    const valid = fetches.filter((x): x is number => x !== null)
    const age = valid.length ? Math.min(...valid) : null
    const active = (closures.data ?? []) as Array<{ published_at: string | null }>
    const oldest = active.length ? minutesSince(active[0]?.published_at ?? null) : null
    rows.push({
      group: '市の発表',
      label: `役所の通行止め（情報源 ${fetches.length}件）`,
      lastAt: null,
      ageMinutes: age,
      expectMinutes: 120,
      level: levelOf(age, 120),
      detail: `通行止め中 ${active.length}件`,
      judgedAgeText: active.length ? `いちばん古い発表は ${hoursText(oldest)}` : '—',
    })
  }

  // 7. SNS巡回
  {
    const run = snsRun.data?.[0] as { finished_at: string | null; status: string | null; discovered_count: number | null } | undefined
    const age = minutesSince(run?.finished_at ?? null)
    rows.push({
      group: '外から取り込むもの',
      label: 'SNSの巡回',
      lastAt: run?.finished_at ?? null,
      ageMinutes: age,
      expectMinutes: 90,
      level: levelOf(age, 90),
      detail: run ? `前回 ${run.status ?? '不明'}／見つけた投稿 ${run.discovered_count ?? 0}件` : '実行の記録がありません',
    })
  }

  // 8. 市民の記録（人が入れるものなので、遅れても異常ではない）
  {
    const at = citizen.data?.[0]?.created_at ?? null
    const age = minutesSince(at)
    rows.push({
      group: '市民が入れるもの',
      label: '通れた道・通れない道の記録',
      lastAt: at,
      ageMinutes: age,
      expectMinutes: null,
      level: 'ok',
      detail: '人が記録したときだけ増えます（間が空いても異常ではありません）',
    })
  }

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      worst: rows.some((r) => r.level === 'danger') ? 'danger' : rows.some((r) => r.level === 'late') ? 'late' : 'ok',
      sources: rows,
      note: '「経過」は最後に新しくなってからの時間、「判断の古さ」はいま出している判断が何時間前のものかです。',
    },
    { headers },
  )
}
