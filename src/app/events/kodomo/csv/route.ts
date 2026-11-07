import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadChildPlaceReport } from '@/lib/child-place-data'
import { evidenceToCsv } from '@/lib/child-place-evidence'
import { ymdInJst } from '@/lib/events-calendar'

// 「こどもの居場所カレンダー」の根拠の一覧（1件ずつ）を CSV で保存する。画面の「根拠の一覧」と同じ元データ。
// 公開されているイベントの情報だけで、個人の名前は含まれない（名前のない個人主催は『個人主催（名前は非公開）』）。
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const report = await loadChildPlaceReport(supabase)
  const csv = evidenceToCsv(report.evidence, new URL(request.url).origin)
  const stamp = ymdInJst(report.generatedAt).replace(/-/g, '')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kodomo-ibasho_${stamp}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
