import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// 受付履歴の CSV ダウンロード（直近90日・最大1000件）。
// 権限は受付モードと同じ（承認済みメンバー or 管理者）。Excel 互換のため BOM 付き UTF-8。
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: org } = await supabase.from('organizations').select('id, name').eq('id', id).maybeSingle()
  if (!org) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) {
    const { data: mem } = await supabase
      .from('memberships')
      .select('status')
      .eq('org_id', id)
      .eq('member_id', user.id)
      .eq('status', 'confirmed')
      .is('left_at', null)
      .maybeSingle()
    if (!mem) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const from = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from('checkins')
    .select(
      'member_id, purpose, created_at, members!checkins_member_id_fkey(display_name), scanned:members!checkins_scanned_by_fkey(display_name), events(title)',
    )
    .eq('org_id', id)
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .limit(1000)

  // 実名（member_private・非公開）を service_role で取得。
  // このルートは上の承認済みメンバー/管理者チェックを通過した場合のみ到達する。
  const realNames = new Map<string, string>()
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    const ids = [...new Set((rows ?? []).map((r) => r.member_id))]
    if (url && key && ids.length > 0) {
      const admin = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data } = await admin
        .from('member_private')
        .select('member_id, real_name')
        .in('member_id', ids)
        .not('real_name', 'is', null)
      for (const r of data ?? []) realNames.set(r.member_id, r.real_name as string)
    }
  }

  const esc = (v: string) => `"${v.replaceAll('"', '""')}"`
  const lines = [
    ['日付', '時刻', '実名', '表示名', '受付名/イベント', '受付担当'].map(esc).join(','),
    ...(rows ?? []).map((r) => {
      const m = (Array.isArray(r.members) ? r.members[0] : r.members) as { display_name: string } | null
      const s = (Array.isArray(r.scanned) ? r.scanned[0] : r.scanned) as { display_name: string } | null
      const ev = (Array.isArray(r.events) ? r.events[0] : r.events) as { title: string } | null
      const d = new Date(r.created_at)
      return [
        d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }),
        realNames.get(r.member_id) ?? '',
        m?.display_name ?? '匿名',
        ev?.title ?? r.purpose ?? '受付',
        s?.display_name ?? '-',
      ].map(esc).join(',')
    }),
  ]
  const csv = '﻿' + lines.join('\r\n')

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) // YYYY-MM-DD
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reception_${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
