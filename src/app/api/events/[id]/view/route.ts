// POST /api/events/[id]/view
// イベントページの閲覧を1件記録する（PV / VV 集計用）。
//
// 呼び出し元は EventViewTracker（クライアント部品）。同じ端末・同じイベントは
// 30分に1回までに絞ってあるため、リロード連打で極端に増えることはない。
//
// visitor_key: 端末側で生成した乱数を、ここでハッシュ化して保存する。
//   生の乱数を保存しないことで、万一DBを覗かれても端末の照合に使いにくくする。
//   個人を特定する情報（IP・UA）は保存しない。
//
// 記録は RLS を持たない event_views への挿入のため、service role で行う。

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'

function jstToday(): string {
  // 'YYYY-MM-DD'（Asia/Tokyo）
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let body: { visitorId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const visitorId = typeof body.visitorId === 'string' ? body.visitorId.slice(0, 100) : ''
  if (!visitorId) return NextResponse.json({ ok: false }, { status: 400 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !serviceKey) {
    // 未設定でも閲覧体験を壊さない
    return NextResponse.json({ ok: false, skipped: 'not configured' })
  }

  // ログイン済みなら誰の閲覧かも残す（主催者が「登録者が見たか」を把握できるように）
  let memberId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    memberId = user?.id ?? null
  } catch {
    memberId = null
  }

  const visitorKey = crypto.createHash('sha256').update(`${id}:${visitorId}`).digest('hex')

  const db = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // anon 書き込みテーブルではないが、返り値は不要なので RETURNING させない
  const { error } = await db.from('event_views').insert({
    event_id: id,
    visitor_key: visitorKey,
    member_id: memberId,
    viewed_on: jstToday(),
  })

  if (error) {
    console.error('[events/view] insert failed:', error.message)
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true })
}
