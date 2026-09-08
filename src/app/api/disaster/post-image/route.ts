// 災害MAPのスクリーンショットを受け取って、画像付きでSNSへ投稿する。
//
// GitHub Actions（.github/workflows/disaster-shot.yml）から呼ばれる。
// Actions 側が本番サイトを実際に開いて撮影し、GitHub Pages で公開されたのを
// 確認してから、その画像URLをここへ渡してくる。
//
// なぜ分けているか：
//   Vercel ではヘッドレスブラウザを安定して動かせず、10分ごとの巡回
//   （＝速報の経路）に入れると速報そのものを止めかねない。
//   撮影は Actions、投稿は Vercel（認証情報を外へ出さない）と分担する。
//
// 認証：DISASTER_SHOT_SECRET を突き合わせるだけ。
//   投稿できる媒体は Instagram（と任意で Threads）に限られ、本文は
//   直前に自動投稿が作ったものを使うので、悪用の余地は小さい。

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadSnsCredentials, postToMedium } from '@/lib/sns-dispatch'
import type { SnsMedium } from '@/lib/sns-template'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// 画像URLは自分のサイトのものだけ受け付ける（他所の画像を投稿させないため）
const ALLOWED_IMAGE_PREFIX = 'https://communitybankinzai.github.io/cbi-site/assets/disaster/'

export async function POST(request: Request) {
  const secret = process.env.DISASTER_SHOT_SECRET
  if (!secret) return NextResponse.json({ error: 'DISASTER_SHOT_SECRET not configured' }, { status: 503 })

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (String(payload.secret ?? '') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const imageUrl = String(payload.imageUrl ?? '')
  if (!imageUrl.startsWith(ALLOWED_IMAGE_PREFIX)) {
    return NextResponse.json({ error: 'imageUrl not allowed' }, { status: 400 })
  }

  const supabase = adminClient()
  if (!supabase) return NextResponse.json({ error: 'server_not_configured' }, { status: 503 })

  // 直前の自動投稿が書き残した本文を使う。無ければ投稿しない
  // （文面を外から自由に渡せると、ここが投稿の抜け道になってしまう）
  const requestId = String(payload.requestId ?? '')
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `disaster_shot_request:${requestId}`)
    .maybeSingle()
  const req = (data?.value ?? null) as { text?: string; media?: string[]; status?: string } | null
  if (!req?.text) {
    return NextResponse.json({ error: 'request not found or expired', requestId }, { status: 404 })
  }
  if (req.status === 'done') {
    return NextResponse.json({ ok: true, skipped: 'already posted' })
  }

  // 二重投稿を防ぐため、投稿する前に状態を進める
  await supabase.from('app_settings').upsert({
    key: `disaster_shot_request:${requestId}`,
    value: { ...req, status: 'done', imageUrl, postedAt: new Date().toISOString() },
  })

  const media = (Array.isArray(req.media) ? req.media : ['instagram']).filter(
    (m): m is SnsMedium => m === 'instagram' || m === 'threads',
  )
  const creds = await loadSnsCredentials(supabase)
  const result: Record<string, unknown> = {}
  for (const medium of media) {
    try {
      result[medium] = await postToMedium(medium, req.text, creds, { imageUrl })
    } catch (error) {
      result[medium] = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  await supabase.from('app_settings').upsert({
    key: `disaster_shot_request:${requestId}`,
    value: { ...req, status: 'done', imageUrl, postedAt: new Date().toISOString(), result },
  })
  return NextResponse.json({ ok: true, imageUrl, result })
}
