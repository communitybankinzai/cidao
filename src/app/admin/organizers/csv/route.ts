import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadOrganizerReport } from '@/lib/organizer-report-data'
import { organizerGroupsToCsv } from '@/lib/organizer-groups'

// 主催者の開催実績（団体別）の CSV。管理者だけ。Excel で文字化けしないよう BOM 付き UTF-8。
// 開催回数は「掲載された開催日の数」で、実際に開催された証拠ではない。
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const report = await loadOrganizerReport(supabase)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '')
  return new NextResponse(organizerGroupsToCsv(report.groups), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="organizers_${today}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
