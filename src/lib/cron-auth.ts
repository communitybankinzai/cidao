// 巡回・定期実行の呼び出し元の確認（Vercel Cron と Supabase pg_cron の両方）。
// どちらも Authorization: Bearer <CRON_SECRET> を付けて呼ぶ。合言葉が無い・違うときは 401 を返す側で使う。
// 2026-11-06: 災害情報の巡回 POST（timeline・sns-monitor・road-closures・pref-road-kisei）が
// 鍵なしで誰でも起動できる状態だったため、ここに寄せて必須化した。

import { timingSafeEqual } from 'node:crypto'

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
