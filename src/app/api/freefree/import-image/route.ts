// 外部URLの画像を1枚だけ freefree-images に取り込む。
//
// URL読み取り（/api/freefree/scan-url）が返した候補のうち、掲載者が
// 「この画像を使う」と選び、掲載の権利を確認したものだけをここで保存する。
// 他人のページの画像を自動で転載しないための線引きなので、
// 呼び出し側は必ず本人の明示操作を経てから叩くこと。
//
// env: なし（Supabase のユーザーセッションで保存する）
// 認可: 未ログインは弾く

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseSafeUrl } from '@/lib/url-guard'

const BUCKET = 'freefree-images'
const MAX_BYTES = 5 * 1024 * 1024 // バケットの上限と揃える
const FETCH_TIMEOUT_MS = 15_000

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const url = parseSafeUrl(String(body?.url ?? ''))
  if (!url) return NextResponse.json({ ok: false, reason: 'blocked' })

  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; CiDAO-FreefreeScan/1.0; +https://cidao.vercel.app)',
        accept: 'image/*',
      },
    })
  } catch (err) {
    console.error('[freefree/import-image] fetch failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, reason: 'fetch' })
  }
  if (!res.ok) return NextResponse.json({ ok: false, reason: 'fetch' })

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXT[contentType]
  if (!ext) return NextResponse.json({ ok: false, reason: 'unsupported_type' })

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) return NextResponse.json({ ok: false, reason: 'empty' })
  if (buf.length > MAX_BYTES) return NextResponse.json({ ok: false, reason: 'too_large' })

  const path = `pending/${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, cacheControl: '300' })
  if (error) {
    console.error('[freefree/import-image] upload failed:', error.message)
    return NextResponse.json({ ok: false, reason: 'upload' })
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ ok: true, url: pub.publicUrl, sourceUrl: url.toString() })
}
