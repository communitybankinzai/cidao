// 消防情報の見張り（CBI scripts/fire_mail_watch.py）が「最後にメールを確認した時刻」を預かって、防災MAPへ返す。
//
// POST: 見張りが5分ごとの確認のたびに呼ぶ。時刻はこのサーバーの現在時刻を保存する（見張りPCの時計に左右されない）。
//       認証は /api/disaster/fire-notify と同じ Authorization: Bearer <fireNotifyToken(SUPABASE_SERVICE_ROLE_KEY)>。新しい環境変数は要らない。
// GET:  公開。防災MAPが「🔥消防情報・💥事故・🚑救急支援・🗂履歴」をONにするたびに呼び、「最終確認 ○分前」を出す。
//       返すのは確認した時刻だけ（メールの中身は返さない）。
//
// なぜ必要か：公開データ fire-incidents.json の checkedAt は、変化がない間は約3時間ごとにしか書き換えない
// （コミットが1日48件になるのを避ける・2026-10-14 事業主決定B）。それをそのまま「最終確認」として見せると、
// 実際は5分前なのに数時間前と出てしまう。見張りが止まったときに気づけるよう、確認の事実だけをここに集める。
// 保存先は app_settings（key=fire_mail_watch_heartbeat）の1行。5分ごとの上書きだけで増えない。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyFireNotifyToken } from '@/lib/disaster-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

const SETTINGS_KEY = 'fire_mail_watch_heartbeat'

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

  const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 500, headers })

  const raw = (data?.value as { checkedAt?: unknown } | null)?.checkedAt
  const at = typeof raw === 'string' ? Date.parse(raw) : NaN
  if (!Number.isFinite(at)) return NextResponse.json({ checkedAt: null, ageSeconds: null }, { headers })
  return NextResponse.json(
    { checkedAt: new Date(at).toISOString(), ageSeconds: Math.max(0, Math.round((Date.now() - at) / 1000)) },
    { headers },
  )
}

export async function POST(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!verifyFireNotifyToken(serviceKey, bearer)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 })

  const checkedAt = new Date().toISOString()
  const { error } = await supabase.from('app_settings').upsert({ key: SETTINGS_KEY, value: { checkedAt } })
  if (error) {
    console.error('[fire-watch] save failed:', error.message)
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, checkedAt })
}
