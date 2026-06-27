import { NextResponse } from 'next/server'
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
  const supabase = await createClient()

  // 「人材バンクに掲載されている人」= member_profiles_pr に公開行があり message_acceptance != 'closed'
  // /talent と同じ定義
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
