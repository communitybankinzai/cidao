// 通れた道・通れない地点の雨の判定を、今の式（src/lib/disaster-rain-logic.ts）で全件やり直す。
// 式や既定値を変えて RAIN_LOGIC_VERSION を上げたら実行する。
//   npx tsx scripts/backfill-rain-logic.ts --dry   … 書き込まずに件数だけ
//   npx tsx scripts/backfill-rain-logic.ts         … 書き込む
// 雨量は手元の控え（disaster_amedas_10min）から取る。控えが無い古い時期は unknown になり、その行は書き換えない。
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

async function main() {
  const { rainAt } = await import('../src/lib/disaster-amedas-rain')
  const { RAIN_LOGIC_VERSION } = await import('../src/lib/disaster-rain-logic')
  const dry = process.argv.includes('--dry')
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data, error } = await supabase.from('disaster_passed_roads').select('id, kind, path, ended_at, rain_verdict').order('ended_at')
  if (error) throw error
  const tally: Record<string, number> = {}
  let written = 0
  for (const row of data ?? []) {
    const path = row.path as [number, number][]
    if (!path?.length) continue
    const rain = await rainAt(path[path.length - 1], new Date(row.ended_at))
    const key = `${row.kind}:${row.rain_verdict}→${rain.verdict}${rain.basis ? `(${rain.basis})` : ''}`
    tally[key] = (tally[key] ?? 0) + 1
    if (rain.verdict === 'unknown' || dry) continue
    const { error: upError } = await supabase.from('disaster_passed_roads').update({
      rain_station: rain.station, rain_at: rain.at,
      rain_1h_mm: rain.r1h, rain_3h_mm: rain.r3h, rain_24h_mm: rain.r24h, rain_verdict: rain.verdict,
      rain_72h_mm: rain.r72h ?? null, rain_peak1h_mm: rain.peak1h ?? null, rain_bucket_mm: rain.bucket ?? null,
      rain_api_mm: rain.api ?? null, rain_basis: rain.basis ?? null, rain_logic: RAIN_LOGIC_VERSION,
    }).eq('id', row.id)
    if (upError) throw upError
    written += 1
  }
  console.log(JSON.stringify({ total: data?.length ?? 0, written, dry, tally }, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
