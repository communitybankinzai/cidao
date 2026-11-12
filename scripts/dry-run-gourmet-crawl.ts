// 食レポの SNS 巡回の試験（書き込みなし・2026-11-13）。
// Instagram の投稿（Graph API の media の JSON を保存したもの）を AI で読み、食レポマップのお店と照合した結果を表にする。
// DB には何も書かない。AI の呼び出しの費用だけかかる。
//   npx tsx scripts/dry-run-gourmet-crawl.ts <media.json> [<media.json> …] --out <結果.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { anthropicClient, needsWorkspaceHeader } from '../src/lib/disaster-sns-road-ai'
import { buildCandidateShops, captionHash, estimateCostJpy, extractGourmet, shopEntriesFrom } from '../src/lib/gourmet-crawl'
import { GOURMET_MAP_URL } from '../src/lib/cbi-site-urls'

type Media = { id: string; caption?: string; media_type?: string; permalink: string; timestamp: string }

async function main() {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const out = outIdx >= 0 ? args[outIdx + 1] : 'gourmet-dry-run.json'
  const files = args.filter((a, i) => a !== '--out' && i !== outIdx + 1 && a !== '--rematch' && args[i - 1] !== '--rematch')
  const res = await fetch(`${GOURMET_MAP_URL}osm-shops.json`)
  const osm = ((await res.json()) as { shops: Parameters<typeof shopEntriesFrom>[0] }).shops
  const shops = shopEntriesFrom(osm, [])
  console.log('照合するお店', shops.length, '件')
  // --rematch：前回の結果（AI の読み取り）を使い、照合だけやり直す（AI を呼ばない）
  const re = args.indexOf('--rematch')
  if (re >= 0) {
    const prev = JSON.parse(readFileSync(args[re + 1], 'utf8')) as { rows: Array<{ extraction?: Parameters<typeof buildCandidateShops>[0]; candidates?: unknown }> }
    for (const r of prev.rows) if (r.extraction) r.candidates = buildCandidateShops(r.extraction, shops)
    writeFileSync(out, JSON.stringify(prev, null, 1))
    console.log('照合だけやり直した', out)
    return
  }
  let client = anthropicClient()
  const rows: unknown[] = []
  let input = 0, output = 0
  for (const f of files) {
    const media = JSON.parse(readFileSync(f, 'utf8')) as Media[]
    for (const m of media) {
      const caption = m.caption ?? ''
      if (!caption.trim()) { rows.push({ file: f, permalink: m.permalink, skipped: '本文なし' }); continue }
      let r
      try { r = await extractGourmet(client, caption) } catch (e) {
        if (!needsWorkspaceHeader(e)) throw e
        client = anthropicClient(true); r = await extractGourmet(client, caption)
      }
      input += r.usage.input; output += r.usage.output
      const cands = buildCandidateShops(r.extraction, shops)
      rows.push({ file: f, permalink: m.permalink, timestamp: m.timestamp, captionHash: captionHash(caption).slice(0, 12), caption: caption.slice(0, 400), extraction: r.extraction, candidates: cands })
      process.stdout.write('.')
    }
  }
  writeFileSync(out, JSON.stringify({ input, output, costJpy: estimateCostJpy({ input, output }), rows }, null, 1))
  console.log(`\n書き出し ${out} / 入力 ${input}・出力 ${output} トークン・約 ${estimateCostJpy({ input, output }).toFixed(1)} 円`)
}
main().catch((e) => { console.error(e); process.exit(1) })
