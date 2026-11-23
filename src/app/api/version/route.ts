// GET /api/version
// いま本番に出ている版の番号を返す（2026-11-23）。
//
// 呼ぶのは VersionRefresher（layout.tsx に常駐）。開いたままの画面が持っている番号と違えば、画面を読み直す。
// ビルドのときに中身が決まる固定の応答（force-static）なので、読まれても関数は動かない。
// 入口の処理（proxy.ts）も通さない。番号は next.config.ts の NEXT_PUBLIC_BUILD_ID

import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json({ v: process.env.NEXT_PUBLIC_BUILD_ID ?? '' })
}
