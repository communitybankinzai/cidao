// 千葉県の道路規制状況図の見張り。pg_cron `cidao_pref_road_kisei`（30分ごと）が POST する。
// 県ページと公開中の pref-road-kisei.json を比べ、違えば cbi-site の取り込みを起動するだけの軽い処理
// （県ページ1枚と JSON 1つを読む）。中身は src/lib/pref-road-kisei-watch.ts。
// 鍵は付けていない：起動するのは食い違いがあるときだけで、取り込み側（Actions）は同時に1本しか走らない。

import { NextResponse } from 'next/server'
import { watchPrefRoadKisei } from '@/lib/pref-road-kisei-watch'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST() {
  try {
    const result = await watchPrefRoadKisei()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/pref-road-kisei]', message)
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
