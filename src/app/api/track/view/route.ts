// POST /api/track/view
// サイト全体のページ閲覧を1件記録する（PV / VV 集計用）。
//
// 呼び出し元は PageViewTracker（layout.tsx に常駐するクライアント部品）。
// 同じ端末・同じパスは30分に1回までに絞ってあるため、リロード連打で極端に増えることはない。
//
// visitor_key: 端末側で生成した乱数を、ここでハッシュ化して保存する。
//   イベント用（event_views）とは別ソルトのため、両テーブルの突合はできない。
//   個人を特定する情報（IP・UA）は保存しない。
//
// path はクライアントで正規化済みだが、サーバ側でも同じ正規化をかけ直して
// 細工されたパスがそのまま保存されるのを防ぐ。
//
// 記録は RLS を持たない page_views への挿入のため、service role で行う。

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'

const EXCLUDED_PREFIXES = ['/admin', '/me', '/notifications', '/api', '/auth']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 流入元（utm_source）として保存を許可する値。SNS告知リンクで使う既知の媒体名のみ。
// クエリの生値をそのまま保存しない（任意文字列の混入・個人情報の紛れ込みを防ぐ）
// threads は「投稿内リンク経由」、threads-profile は「プロフィールのリンク経由」を区別する
const ALLOWED_SOURCES = new Set(['threads', 'threads-profile', 'instagram', 'facebook', 'line', 'x', 'sns'])

function normalizePath(raw: string): string | null {
  if (!raw.startsWith('/')) return null
  // クエリ・フラグメントは捨てる（個人情報がURLに乗るのを防ぐ）
  const pathname = raw.split(/[?#]/)[0]
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null
  const segments = pathname.split('/').map((seg) => {
    if (UUID_RE.test(seg) || /^\d+$/.test(seg)) return '[id]'
    return seg
  })
  return segments.join('/').slice(0, 200) || '/'
}

function jstToday(): string {
  // 'YYYY-MM-DD'（Asia/Tokyo）
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function POST(request: Request) {
  let body: { path?: unknown; visitorId?: unknown; source?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const rawPath = typeof body.path === 'string' ? body.path.slice(0, 300) : ''
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId.slice(0, 100) : ''
  if (!rawPath || !visitorId) return NextResponse.json({ ok: false }, { status: 400 })

  const path = normalizePath(rawPath)
  if (!path) return NextResponse.json({ ok: false, skipped: 'excluded' })

  // 流入元はホワイトリストに一致した場合のみ保存（それ以外は null = 直接訪問扱い）
  const rawSource = typeof body.source === 'string' ? body.source.trim().toLowerCase() : ''
  const source = ALLOWED_SOURCES.has(rawSource) ? rawSource : null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !serviceKey) {
    // 未設定でも閲覧体験を壊さない
    return NextResponse.json({ ok: false, skipped: 'not configured' })
  }

  // ログイン済みなら誰の閲覧かも残す（登録メンバーの利用状況を把握できるように）
  let memberId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    memberId = user?.id ?? null
  } catch {
    memberId = null
  }

  const visitorKey = crypto.createHash('sha256').update(`site:${visitorId}`).digest('hex')

  const db = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 返り値は不要なので RETURNING させない
  const { error } = await db.from('page_views').insert({
    path,
    visitor_key: visitorKey,
    member_id: memberId,
    viewed_on: jstToday(),
    source,
  })

  if (error) {
    console.error('[track/view] insert failed:', error.message)
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true })
}
