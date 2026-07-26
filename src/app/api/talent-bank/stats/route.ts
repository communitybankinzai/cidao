import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/talent-bank/stats
 *
 * Returns the count of "人材バンク registered" members — same definition as the
 * /talent page: members who have a public PR row in member_profiles_pr and have
 * not closed messaging.
 *
 * Note: an earlier version of this endpoint counted "tier in (email_only,verified)
 * AND interests not null" — that mis-aligned with /talent (which shows PR-published
 * members) and over-counted. Now both use the same source of truth.
 *
 * Response: { registered: number, asOf: ISO8601 }
 *
 * CORS: enabled for the CBI public site.
 */
export async function GET() {
  // 集計は service_role で行う（2026-07-26）。
  // anon 権限だと RLS により public_scope='public' の行しか見えず、
  // 「登録ユーザーのみ」公開のPRがカウントから漏れて実数より少なく表示されるため。
  // 件数のみを返し個人情報は含まないので、service_role 使用でも公開して問題ない。
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabase = supaUrl && serviceKey
    ? createSupabaseClient(supaUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : await createClient()

  // 「人材バンクに掲載されている人」= member_profiles_pr に行があり message_acceptance != 'closed'
  const { count, error } = await supabase
    .from('member_profiles_pr')
    .select('member_id', { count: 'exact', head: true })
    .neq('message_acceptance', 'closed')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders() })
  }

  return NextResponse.json(
    {
      registered: count ?? 0,
      asOf: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    }
  )
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
