// 手元から過去分（台風25号・9/20以降）の候補を AI に掛ける。npx tsx scripts/_backfill_sns_roads.ts [limit]
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { processSnsRoadCandidates, SNS_ROAD_TABLE } from '../src/lib/disaster-sns-road-ai'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
async function main() {
  const limit = Number(process.argv[2] || 60)
  const result = await processSnsRoadCandidates(supabase, { limit })
  console.log(JSON.stringify(result))
  const { data } = await supabase.from(SNS_ROAD_TABLE).select('kind, confidence, location_name, location_basis, observed_at, posted_at, summary, platform').order('posted_at', { ascending: false })
  for (const r of data ?? []) console.log(`[${r.kind}/${r.confidence}] ${r.location_name} | ${r.summary} | ${r.observed_at ?? '(時刻不明)'} | ${r.platform} | ${r.location_basis.slice(0, 20)}`)
}
main().catch((error) => { console.error(error); process.exit(1) })
