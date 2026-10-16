// POST /api/disaster/fire-notify
//
// 手元の見張り（CBI scripts/fire_mail_watch.py）が消防情報（火災・調査活動・事故）の新着を記録した瞬間に、
// その1件だけを渡して会員へベル🔔＋Webプッシュで知らせる（2026-10-16 事業主決定B）。
// 目的: 災害タイムライン巡回は Vercel の無料枠対策で毎時になっているため、巡回を待つと通知が最大1時間遅れる。
// この口は新しい定期実行を作らない（見張りが新着を見つけたときだけ、月に数回呼ぶ）。
//
// 認証: Authorization: Bearer <fireNotifyToken(SUPABASE_SERVICE_ROLE_KEY)>。新しい環境変数は要らない。
// 本文: { "incident": { id, kind, status, addressText, receivedAtIso } }
// 通知の重複は incident id（巡回側と同じ dedupeKey）で防ぐので、あとで巡回が同じ件を読んでも二重には鳴らない。

import { NextResponse } from 'next/server'
import { notifyFireIncident, verifyFireNotifyToken, type FireIncidentLite } from '@/lib/disaster-notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : undefined
}

export async function POST(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!verifyFireNotifyToken(serviceKey, bearer)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const raw = (body && typeof body === 'object' ? (body as Record<string, unknown>).incident : null) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'incident required' }, { status: 400 })
  const inc: FireIncidentLite = {
    id: str(raw.id), kind: str(raw.kind), status: str(raw.status), addressText: str(raw.addressText), receivedAtIso: str(raw.receivedAtIso),
  }
  if (!inc.id) return NextResponse.json({ error: 'incident.id required' }, { status: 400 })

  try {
    const r = await notifyFireIncident(inc)
    console.log(`[fire-notify] id=${inc.id} kind=${inc.kind} sent=${r.sent} recipients=${r.recipients}`)
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[fire-notify] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
