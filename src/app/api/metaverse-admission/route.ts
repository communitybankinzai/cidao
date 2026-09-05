import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// メタバース印西の「入場枠」：Google Photorealistic 3D Tiles の root requests は 1日30回（費用ゼロ運用）なので、
// 3D都市データを要求する前にここで枠を数え、枠が無ければ課金対象の要求を出さずにお断り画面を出す。
// 枠の単位は Google のクォータ集計日（太平洋時間の0時＝日本時間 16〜17時にリセット）に合わせる。
// 上限は app_settings key `metaverse_admission` の { "limit": N } で変えられる（イベント日は Google 側の枠と一緒に上げる）。
// 元は Codex セッションが「累計30回」で作ったものを、2026-09-06 に日単位へ直した（累計だと二度と入れなくなる）。
export const dynamic = 'force-dynamic'
const DEFAULT_LIMIT = 30
const SETTINGS_KEY = 'metaverse_admission'
const origins = new Set(['https://communitybankinzai.github.io', 'http://localhost:8765', 'http://localhost:8766', 'http://localhost:8767', 'http://127.0.0.1:8765'])

function headers(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return { 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store', Vary: 'Origin' }
}
// Google のクォータ集計日（America/Los_Angeles の暦日）
function quotaDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: headers(request) })
}
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: headers(request) })
  if (!origins.has(request.headers.get('origin') ?? '')) return reply({ allowed: false, error: 'origin' }, 403)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return reply({ allowed: false, error: 'not configured' }, 503)
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const body = await request.json()
    if (typeof body.launchId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.launchId)) return reply({ allowed: false, error: 'launchId' }, 400)
    const day = quotaDay()
    const dayKey = `metaverse_admissions_${day}`
    let limit = DEFAULT_LIMIT
    const { data: setting } = await db.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    const configured = Number((setting?.value as { limit?: unknown } | null)?.limit)
    if (Number.isFinite(configured) && configured >= 0) limit = Math.floor(configured)
    // launchId の一覧で数える。同じ launchId の再送は枠を消費しない（再試行が冪等）。
    // JSON 全体の一致を条件に update する CAS で、同時要求が同じ残り枠を二重に取れないようにする
    for (let attempt = 0; attempt < 40; attempt++) {
      const { data, error } = await db.from('app_settings').select('value').eq('key', dayKey).maybeSingle()
      if (error) throw error
      if (!data) {
        const { error: seedError } = await db.from('app_settings').insert({ key: dayKey, value: { launches: [] } })
        if (seedError && seedError.code !== '23505') throw seedError
        continue
      }
      const launches: unknown = (data.value as { launches?: unknown } | null)?.launches
      if (!Array.isArray(launches) || !launches.every((id) => typeof id === 'string')) throw new Error('Invalid admission state')
      if (launches.includes(body.launchId)) return reply({ allowed: true, count: launches.length, limit, day })
      if (launches.length >= limit) return reply({ allowed: false, count: launches.length, limit, day }, 429)
      const next = { launches: [...launches, body.launchId] }
      const { data: claimed, error: claimError } = await db.from('app_settings').update({ value: next })
        .eq('key', dayKey).eq('value', JSON.stringify(data.value)).select('key')
      if (claimError) throw claimError
      if (claimed?.length) return reply({ allowed: true, count: next.launches.length, limit, day })
    }
  } catch {
    return reply({ allowed: false, error: 'server' }, 503)
  }
  return reply({ allowed: false, error: 'busy' }, 503)
}
