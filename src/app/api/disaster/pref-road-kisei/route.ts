// 千葉県の道路規制状況図の見張り。pg_cron `cidao_pref_road_kisei`（30分ごと）が POST する。
// 県ページと公開中の pref-road-kisei.json を比べ、違えば cbi-site の取り込みを起動するだけの軽い処理
// （県ページ1枚と JSON 1つを読む）。中身は src/lib/pref-road-kisei-watch.ts。
// 鍵は付けていない：起動するのは食い違いがあるときだけで、取り込み側（Actions）は同時に1本しか走らない。
//
// 確かめた時刻と結果は app_settings `pref_road_kisei_last_check` に残し、GET で防災MAPへ返す
// （地図の「最終確認：○時○分（30分ごと）」の表示元・2026-09-26 事業主指示）。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { watchPrefRoadKisei } from '@/lib/pref-road-kisei-watch'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SETTING_KEY = 'pref_road_kisei_last_check'

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
])

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function record(value: Record<string, unknown>) {
  const supabase = serviceClient()
  if (!supabase) return
  const { error } = await supabase.from('app_settings').upsert({ key: SETTING_KEY, value })
  if (error) console.error('[disaster/pref-road-kisei] record', error.message)
}

export async function POST() {
  const checkedAt = new Date().toISOString()
  try {
    const result = await watchPrefRoadKisei()
    await record({ checkedAt, ok: true, ...result })
    return NextResponse.json({ ranAt: checkedAt, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/pref-road-kisei]', message)
    await record({ checkedAt, ok: false, error: message.slice(0, 200) })
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    Vary: 'Origin',
    // 確認は30分ごとなので、CDN で1分まとめても十分新しい
    'Cache-Control': 'public, max-age=60, s-maxage=60',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
  }
}

// 最後に確かめた時刻と結果（checkedAt・ok・reason・stamp）。まだ一度も確かめていなければ lastCheck は null
export async function GET(request: Request) {
  const headers = corsHeaders(request)
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503, headers })
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTING_KEY).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 502, headers })
  const value = (data?.value ?? null) as Record<string, unknown> | null
  // GitHub の起動エラーの中身などは返さない
  const lastCheck = value
    ? { checkedAt: value.checkedAt ?? null, ok: value.ok === true, changed: value.dispatched === true, stamp: value.stamp ?? '' }
    : null
  return NextResponse.json({ lastCheck, intervalMinutes: 30 }, { headers })
}
