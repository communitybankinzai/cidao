import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
const origins = new Set(['https://communitybankinzai.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function headers(request: Request) {
  const origin = request.headers.get('origin') || ''
  return {'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type',
    'Cache-Control':'no-store', Vary:'Origin'}
}
function db() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) : null
}
export function OPTIONS(request: Request) { return new NextResponse(null,{status:204,headers:headers(request)}) }
export async function POST(request: Request) {
  const h=headers(request)
  if (!origins.has(request.headers.get('origin') || '')) return NextResponse.json({error:'origin'},{status:403,headers:h})
  const text=await request.text()
  if (text.length>1024) return NextResponse.json({error:'size'},{status:413,headers:h})
  let body
  try { body=JSON.parse(text) } catch { return NextResponse.json({error:'json'},{status:400,headers:h}) }
  if (!body || !uuid.test(String(body.id)) || !uuid.test(String(body.visitorId)) || !['world','disaster-map'].includes(body.content))
    return NextResponse.json({error:'invalid event'},{status:400,headers:h})
  const client=db()
  if (!client) return NextResponse.json({error:'unavailable'},{status:503,headers:h})
  // One document load has one ID; retries cannot increase PV.
  const {error}=await client.from('cbi_content_views').upsert({id:body.id,visitor_id:body.visitorId,content:body.content},{onConflict:'id',ignoreDuplicates:true})
  return NextResponse.json({ok:!error},{status:error?503:200,headers:h})
}
export async function GET(request: Request) {
  const value=Number(new URL(request.url).searchParams.get('days') || 30)
  const days=Number.isFinite(value)?Math.max(1,Math.min(90,Math.floor(value))):30
  const client=db()
  if (!client) return NextResponse.json({error:'unavailable'},{status:503,headers:headers(request)})
  const {data,error}=await client.rpc('cbi_content_daily',{p_days:days})
  // Only aggregate counts are public; visitor identifiers never leave the server.
  return NextResponse.json(error?{error:'aggregation unavailable'}:{daily:data,trackingSince:'2026-09-10',dayBasis:'JST'},
    {status:error?503:200,headers:headers(request)})
}
