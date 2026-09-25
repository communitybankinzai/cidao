// 判定済みの SNS 通行情報を、新しい決まり（写真も見る・AIの座標を使わない・広い場所は置かない）で読み直す。
// 対象は「通行情報あり（report）」と「場所が決まらなかった（no_location）」の判定印。印を外して processSnsRoadCandidates に掛け直す。
// npx tsx scripts/rescan-sns-road-reports.ts [--dry]
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { mediaImageUrls, processSnsRoadCandidates, SNS_ROAD_SCAN_TABLE, SNS_ROAD_TABLE } from '../src/lib/disaster-sns-road-ai'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: allScans, error } = await supabase.from(SNS_ROAD_SCAN_TABLE).select('candidate_id, result').in('result', ['report', 'no_location'])
  if (error) throw error
  // --sample N：写真つきの投稿を優先して N 件だけ試す（--include <文字列> で本文に含む投稿を1件足す）
  const sampleArg = process.argv.indexOf('--sample')
  let scans = allScans
  if (sampleArg > 0) {
    const n = Number(process.argv[sampleArg + 1] || 5)
    const includeArg = process.argv.indexOf('--include')
    const include = includeArg > 0 ? process.argv[includeArg + 1] : ''
    const { data: cands } = await supabase.from('disaster_sns_candidates').select('id, platform, raw_payload, body_text').in('id', (allScans ?? []).map((s) => s.candidate_id))
    const withPhoto = (cands ?? []).filter((c) => mediaImageUrls(c as never).length > 0).map((c) => c.id)
    const extra = include ? (cands ?? []).filter((c) => String(c.body_text).includes(include)).map((c) => c.id).slice(0, 1) : []
    const picked = new Set([...extra, ...withPhoto].slice(0, n))
    scans = (allScans ?? []).filter((s) => picked.has(s.candidate_id))
  }
  console.log(`読み直す候補: ${scans?.length ?? 0}件`)
  if (process.argv.includes('--dry') || !scans?.length) return
  const ids = scans.map((s) => s.candidate_id)
  for (let i = 0; i < ids.length; i += 100) {
    const { error: delError } = await supabase.from(SNS_ROAD_SCAN_TABLE).delete().in('candidate_id', ids.slice(i, i + 100))
    if (delError) throw delError
  }
  const total = { scanned: 0, reports: 0, noLocation: 0, none: 0, errors: 0, inputTokens: 0, outputTokens: 0 }
  for (;;) {
    const result = await processSnsRoadCandidates(supabase, { limit: Math.min(20, ids.length) })
    for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += result[k]
    console.log(JSON.stringify(result))
    if (!result.scanned || !result.remaining || sampleArg > 0) break
  }
  console.log('合計', JSON.stringify(total))
  const { data } = await supabase.from(SNS_ROAD_TABLE).select('kind, confidence, hidden, location_name, location_basis, image_note, latitude, longitude').in('candidate_id', ids).order('posted_at')
  for (const r of data ?? []) console.log(`[${r.kind}/${r.confidence}${r.hidden ? '/伏' : ''}] ${r.location_name} | ${String(r.location_basis).slice(0, 40)} | ${Number(r.latitude).toFixed(4)},${Number(r.longitude).toFixed(4)} | 写真:${String(r.image_note).slice(0, 60)}`)
}
main().catch((error) => { console.error(error); process.exit(1) })
