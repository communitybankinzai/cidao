// 鉄道・バスの運休情報を防災MAPへ配る。
//
// 登録（どの区間が止まっているか）は人が app_settings へ入れる。ここでやるのは解除だけを自動にすること。
// 判定は src/lib/disaster-rail-status.ts（テストあり）。市が運転再開を発表すると
// 「災害時の公共交通のご案内」の本文から運休の記述が消えるので、すでに取り込んでいる
// その本文（disaster_timeline_items）と突き合わせ、記述が消えた項目と期限切れの項目を落とす。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { filterRailStatus, type RailStatus } from '@/lib/disaster-rail-status'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SETTINGS_KEY = 'disaster_rail_status'
// 市の案内ページを見張っている情報源（disaster_info_sources.kind）
const SOURCE_KIND = 'city-page-watch'

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...corsHeaders(request), 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  })
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(request: Request) {
  const headers = corsHeaders(request)
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503, headers })

  const [{ data: setting }, { data: sources }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle(),
    supabase.from('disaster_info_sources').select('id').eq('kind', SOURCE_KIND).eq('enabled', true),
  ])

  const status = (setting?.value ?? {}) as RailStatus

  // 市の案内ページの、取り込み済みの最新本文
  let pageText = ''
  let pageAt: string | null = null
  const sourceIds = (sources ?? []).map((row) => row.id as string)
  if (sourceIds.length) {
    const { data: items } = await supabase
      .from('disaster_timeline_items')
      .select('body, occurred_at')
      .in('source_id', sourceIds)
      .order('occurred_at', { ascending: false })
      .limit(1)
    const latest = items?.[0]
    if (latest) {
      pageText = String(latest.body ?? '')
      pageAt = String(latest.occurred_at ?? '')
    }
  }

  const { railways, buses, cleared } = filterRailStatus(status, pageText)

  return NextResponse.json({
    updatedAt: status.updatedAt ?? null,
    checkedAt: new Date().toISOString(),
    note: status.note ?? null,
    source: status.source ?? null,
    railways,
    buses,
    cleared,
    cityPage: { readAt: pageAt, available: Boolean(pageText) },
  }, { headers })
}
