// 雨の記録の控え（2026-11-26）。pg_cron（cidao_rain_archive・毎時）が POST で呼ぶ。
// 雨雲レーダーの区分（disaster_radar_rain）とアメダスの10分値（disaster_amedas_10min）を貯める。中身は src/lib/disaster-rain-archive.ts。
// GET は、貯まっている範囲と直近の取り込みの様子だけを返す（升目の中身は返さない）。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron-auth'
import { archiveAmedas, archiveRadar, RADAR_GRID } from '@/lib/disaster-rain-archive'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503 })

  // 片方が失敗しても、もう片方は貯める
  const [radar, amedas] = await Promise.allSettled([archiveRadar(supabase), archiveAmedas(supabase)])
  const result = {
    ranAt: new Date().toISOString(),
    radar: radar.status === 'fulfilled' ? radar.value : { error: String(radar.reason?.message ?? radar.reason) },
    amedas: amedas.status === 'fulfilled' ? amedas.value : { error: String(amedas.reason?.message ?? amedas.reason) },
  }
  // 次の日に気づけるよう、結果を1行だけ残す（情報源の点検画面などから読む）
  await supabase.from('app_settings').upsert({ key: 'rain_archive_last', value: result }, { onConflict: 'key' })
  const failed = radar.status === 'rejected' || amedas.status === 'rejected'
  if (failed) console.error('[disaster/rain-archive]', JSON.stringify(result))
  return NextResponse.json(result, { status: failed ? 502 : 200, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET() {
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503 })
  const [newest, oldest, last] = await Promise.all([
    supabase.from('disaster_radar_rain').select('observed_at, wet_cells, max_class').order('observed_at', { ascending: false }).limit(1),
    supabase.from('disaster_radar_rain').select('observed_at').order('observed_at', { ascending: true }).limit(1),
    supabase.from('app_settings').select('value').eq('key', 'rain_archive_last').maybeSingle(),
  ])
  return NextResponse.json(
    {
      grid: RADAR_GRID,
      radar: { oldest: oldest.data?.[0]?.observed_at ?? null, newest: newest.data?.[0] ?? null },
      lastRun: last.data?.value ?? null,
    },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  )
}
