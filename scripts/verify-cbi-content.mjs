import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
process.loadEnvFile('.env.local')
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}})
await client.connect()
try {
  await client.query('BEGIN')
  await client.query('SET LOCAL ROLE service_role')
  const before=(await client.query('select * from public.cbi_content_daily(1)')).rows
  const visitor=randomUUID(),id=randomUUID()
  for(const [event,content] of [[id,'world'],[id,'world'],[randomUUID(),'world'],[randomUUID(),'disaster-map']])
    await client.query('insert into public.cbi_content_views(id,visitor_id,content) values($1,$2,$3) on conflict(id) do nothing',[event,visitor,content])
  const after=(await client.query('select * from public.cbi_content_daily(1)')).rows
  for(const content of ['world','disaster-map']) {
    const a=after.find(r=>r.content===content),b=before.find(r=>r.content===content)
    assert.equal(Number(a.pv)-Number(b.pv),content==='world'?2:1)
    assert.equal(Number(a.vv)-Number(b.vv),1)
  }
  const permission=(await client.query("select has_table_privilege('anon','public.cbi_content_views','select') allowed")).rows[0]
  assert.equal(permission.allowed,false)
  console.log('PASS distinct PV/VV, retry deduplication, isolated content, no anonymous raw access; all test rows rolled back')
} finally {await client.query('ROLLBACK');await client.end()}
