import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/talent-bank/stats
 *
 * Returns the count of "人材バンク registered" members.
 * A talent-bank-registered member = tier in ('email_only','verified') AND has at least one interest.
 * This is the same definition we surface on the CBI site and CiDAO home as a public counter.
 *
 * Response: { registered: number, asOf: ISO8601 }
 *
 * CORS: enabled for the CBI public site (cbi.communitybankinzai.org and *.github.io).
 */
export async function GET() {
  const supabase = await createClient()

  // tier in (email_only, verified) AND interests is non-empty
  const { count, error } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .in('tier', ['email_only', 'verified'])
    .is('deleted_at', null)
    .not('interests', 'is', null)

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
