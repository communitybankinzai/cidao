import { NextResponse } from 'next/server'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import { signedVideoUrl } from '@/lib/talent-bank/video/jobs'

// 紹介動画の再生・保存（2026-09-15）。権限を確かめて、非公開バケットの署名付き URL（1時間）へ転送する。
// ?download=1 でスマホに保存（ファイル名付き）、?thumb=1 でサムネイル。
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const db = await createTalentBankClient()
  const { data } = await db.auth.getUser()
  const viewerId = data.user?.id ?? null
  const admin = viewerId ? await db.rpc('is_admin') : null
  const url = new URL(request.url)
  const signed = await signedVideoUrl({ videoId: id, viewerId, isAdmin: !!admin?.data, download: url.searchParams.get('download') === '1', thumb: url.searchParams.get('thumb') === '1' })
  if (!signed) return NextResponse.json({ error: 'not found' }, { status: viewerId ? 404 : 401 })
  return NextResponse.redirect(signed, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
}
