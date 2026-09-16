import { NextResponse } from 'next/server'
import { createTalentBankServiceClient } from '@/lib/talent-bank/db'
import { queueVideo } from '@/lib/talent-bank/video/jobs'

// 紹介動画のまとめ積み（2026-09-15）：公開中のプロフィールがあって動画がまだ無い人の分を、まとめて待ち行列に入れる。
// 従来PRから移し替えた10人分を作るために追加。Vercel Cron と同じ CRON_SECRET（Authorization: Bearer）で守る。
// ?limit=N で一度に積む人数（既定 20）。写真が無い人はアイコンが使われる（queueVideo 側）。
export const maxDuration = 60
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 20)))
  const db = createTalentBankServiceClient()
  const [profiles, videos] = await Promise.all([
    db.from('talent_profiles').select('member_id').not('current_version_id', 'is', null).order('updated_at'),
    // 失敗・取り下げ済みは「動画が無い」扱い（作り直しの対象）
    db.from('talent_videos').select('member_id').in('status', ['queued', 'rendering', 'owner_review', 'owner_approved', 'published']),
  ])
  if (profiles.error || videos.error) return NextResponse.json({ error: 'storage' }, { status: 500 })
  const has = new Set((videos.data ?? []).map(v => v.member_id))
  const targets = (profiles.data ?? []).map(p => p.member_id).filter(id => !has.has(id)).slice(0, limit)
  const results: Record<string, string> = {}
  for (const memberId of targets) {
    try { results[memberId] = (await queueVideo({ memberId, trigger: 'profile_published' })) ? 'queued' : 'skipped' }
    catch (error) { results[memberId] = `error:${error instanceof Error ? error.message : 'unknown'}` }
  }
  return NextResponse.json({ candidates: targets.length, results })
}
