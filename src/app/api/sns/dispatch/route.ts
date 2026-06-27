// POST /api/sns/dispatch
// sns_post_logs の pending 行を読み、各媒体 API を呼んで実投稿する。
// 認証情報が未設定の媒体は pending のまま error_message='credentials missing' にする。
//
// 環境変数:
//   FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN
//   LINE_CHANNEL_ACCESS_TOKEN (Messaging API)
//   X_BEARER_TOKEN (※ X API 有料化のため Phase 2 で接続予定)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSnsContent, type SnsTarget } from '@/lib/sns-template'

type Log = {
  id: string
  target_type: 'freefree' | 'event' | 'org'
  target_id: string
  medium: 'x' | 'facebook' | 'line'
  status: 'success' | 'failed' | 'pending'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let maxLogs = 30
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body.max === 'number' && body.max > 0 && body.max <= 100) {
      maxLogs = body.max
    }
  } catch { /* default */ }

  const { data: pendings, error } = await supabase
    .from('sns_post_logs')
    .select('id, target_type, target_id, medium, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(maxLogs)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ id: string; medium: string; outcome: string; message?: string }> = []

  for (const log of (pendings ?? []) as Log[]) {
    // ターゲット情報取得
    const target = await fetchTarget(supabase, log.target_type, log.target_id)
    if (!target) {
      await markLog(supabase, log.id, 'failed', 'target not found or removed')
      results.push({ id: log.id, medium: log.medium, outcome: 'failed', message: 'target not found' })
      continue
    }
    const content = generateSnsContent(target, log.medium)

    try {
      const out = await postToMedium(log.medium, content)
      await markLog(supabase, log.id, out.status, out.message, out.posted_id)
      results.push({ id: log.id, medium: log.medium, outcome: out.status, message: out.message })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await markLog(supabase, log.id, 'failed', msg)
      results.push({ id: log.id, medium: log.medium, outcome: 'failed', message: msg })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}

type AnySupabase = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>

async function fetchTarget(
  supabase: AnySupabase,
  target_type: 'freefree' | 'event' | 'org',
  target_id: string,
): Promise<SnsTarget | null> {
  if (target_type === 'freefree') {
    const { data } = await supabase
      .from('freefree_posts')
      .select('id, title, body, category, location, status')
      .eq('id', target_id)
      .maybeSingle()
    if (!data || data.status !== 'active') return null
    return {
      target_type, target_id,
      title: String(data.title),
      body: data.body as string | null,
      category: data.category as string | null,
      location: data.location as string | null,
    }
  }
  if (target_type === 'event') {
    const { data } = await supabase
      .from('events')
      .select('id, title, description, location, start_at, organizer_name, status')
      .eq('id', target_id)
      .maybeSingle()
    if (!data || data.status !== 'open') return null
    return {
      target_type, target_id,
      title: String(data.title),
      body: data.description as string | null,
      location: data.location as string | null,
      start_at: data.start_at as string | null,
      organizer_name: data.organizer_name as string | null,
    }
  }
  // org
  const { data } = await supabase
    .from('organizations')
    .select('id, name, description')
    .eq('id', target_id)
    .maybeSingle()
  if (!data) return null
  return {
    target_type, target_id,
    title: String(data.name),
    body: data.description as string | null,
  }
}

async function markLog(
  supabase: AnySupabase,
  id: string,
  status: 'success' | 'failed' | 'pending',
  message?: string,
  posted_id?: string,
) {
  const payload: Record<string, unknown> = {
    status,
    error_message: status === 'success' ? null : (message ?? null),
  }
  if (status === 'success') {
    payload.posted_at = new Date().toISOString()
    if (posted_id) payload.posted_id = posted_id
  }
  await supabase.from('sns_post_logs').update(payload).eq('id', id)
}

type PostOutcome = { status: 'success' | 'failed' | 'pending'; message?: string; posted_id?: string }

async function postToMedium(medium: 'x' | 'facebook' | 'line', content: string): Promise<PostOutcome> {
  if (medium === 'facebook') {
    const pageId = process.env.FACEBOOK_PAGE_ID
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
    if (!pageId || !token) return { status: 'pending', message: 'credentials missing: FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN' }
    const r = await fetch(`https://graph.facebook.com/v22.0/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: content, access_token: token }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { status: 'failed', message: `FB ${r.status}: ${JSON.stringify(j).slice(0, 200)}` }
    return { status: 'success', posted_id: String(j.id ?? '') }
  }
  if (medium === 'line') {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
    if (!token) return { status: 'pending', message: 'credentials missing: LINE_CHANNEL_ACCESS_TOKEN' }
    // LINE Messaging API broadcast（フォロワー全員に配信）
    const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: 'text', text: content.slice(0, 5000) }] }),
    })
    if (!r.ok) {
      const t = await r.text()
      return { status: 'failed', message: `LINE ${r.status}: ${t.slice(0, 200)}` }
    }
    return { status: 'success' }
  }
  // x: 有料化のため Phase 2、現状は常に pending
  return { status: 'pending', message: 'X (Twitter) API は有料化により未接続（Phase 2 で接続予定）' }
}
