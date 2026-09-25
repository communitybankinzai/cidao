// SNS通行情報の読み取りを、同じ投稿で2つのモデルに掛けて比べる（DB には書き込まない）。
// npx tsx scripts/compare-sns-road-models.ts [件数=15] [--effort low|medium|high]
// 出力：scripts/_out/compare-sns-road-models.json と標準出力の表
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropicClient, extractRoadReport, isWideArea, locateRoadReport, mediaImageUrls, needsWorkspaceHeader } from '../src/lib/disaster-sns-road-ai'

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

// 100万トークンあたりの料金（ドル）。2026-09 時点の公式料金表
const MODELS = [
  { id: 'claude-haiku-4-5', input: 1, output: 5 },
  { id: 'claude-sonnet-5', input: 2, output: 10 },
]

async function main() {
  const n = Number(process.argv[2] || 15)
  const effortArg = process.argv.indexOf('--effort')
  const effort = (effortArg > 0 ? process.argv[effortArg + 1] : 'low') as 'low' | 'medium' | 'high'
  const { data: scans } = await supabase.from('disaster_sns_road_scans').select('candidate_id').in('result', ['report', 'no_location'])
  const { data: cands } = await supabase.from('disaster_sns_candidates')
    .select('id, platform, permalink, body_text, posted_at, review_status, raw_payload').in('id', (scans ?? []).map((s) => s.candidate_id))
  const all = (cands ?? []) as Array<Record<string, unknown> & { id: string; body_text: string }>
  // 写真つきを優先し、成田湯川駅の投稿を必ず入れ、残りを本文だけの投稿で埋める
  const narita = all.filter((c) => c.body_text.includes('成田湯川')).slice(0, 1)
  const photo = all.filter((c) => mediaImageUrls(c as never).length > 0 && !narita.includes(c))
  const text = all.filter((c) => mediaImageUrls(c as never).length === 0 && !narita.includes(c))
  const picked = [...narita, ...photo.slice(0, Math.ceil(n * 0.7)), ...text].slice(0, n)

  let client: Anthropic = anthropicClient()
  const rows: Array<Record<string, unknown>> = []
  const totals: Record<string, { cost: number; input: number; output: number; ms: number }> = {}
  for (const c of picked) {
    const row: Record<string, unknown> = { id: c.id, platform: c.platform, photos: mediaImageUrls(c as never).length, body: c.body_text.replace(/\s+/g, ' ').slice(0, 140) }
    for (const m of MODELS) {
      const started = Date.now()
      let result
      try {
        result = await extractRoadReport(client, c as never, fetch, m.id, effort)
      } catch (error) {
        if (!needsWorkspaceHeader(error)) { row[m.id] = { error: String(error).slice(0, 200) }; continue }
        client = anthropicClient(true)
        result = await extractRoadReport(client, c as never, fetch, m.id, effort)
      }
      const ms = Date.now() - started
      const { extraction: x, usage, imageCount } = result
      const cost = (usage.input * m.input + usage.output * m.output) / 1e6
      const t = (totals[m.id] ||= { cost: 0, input: 0, output: 0, ms: 0 })
      t.cost += cost; t.input += usage.input; t.output += usage.output; t.ms += ms
      const located = x.is_road_report && x.kind !== 'unknown' ? await locateRoadReport(x).catch(() => null) : null
      row[m.id] = {
        road: x.is_road_report, kind: x.kind, place: x.location_text, source: x.location_source, wide: x.location_text ? isWideArea(x.location_text) : null,
        image: x.image_findings, confidence: x.confidence, summary: x.summary, reason: x.reason,
        at: located ? `${located.lat.toFixed(4)},${located.lng.toFixed(4)}` : null, basis: located?.basis.slice(0, 40) ?? null,
        imageCount, input: usage.input, output: usage.output, cost: Number(cost.toFixed(5)), ms,
      }
      await new Promise((resolve) => setTimeout(resolve, 1100)) // Nominatim 1秒1回
    }
    rows.push(row)
    const h = row['claude-haiku-4-5'] as Record<string, unknown>, s = row['claude-sonnet-5'] as Record<string, unknown>
    console.log(`#${rows.length} 写真${row.photos} | H: ${h?.kind}/${h?.place || '-'}/${h?.at || '置かない'} | S: ${s?.kind}/${s?.place || '-'}/${s?.at || '置かない'}`)
  }
  fs.mkdirSync('scripts/_out', { recursive: true })
  fs.writeFileSync('scripts/_out/compare-sns-road-models.json', JSON.stringify({ effort, totals, rows }, null, 2))
  console.log('合計', JSON.stringify(totals))
}
main().catch((error) => { console.error(error); process.exit(1) })
