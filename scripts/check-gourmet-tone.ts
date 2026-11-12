// 食レポの SNS 巡回の試験（書き込みなし・2026-11-13）：見本の文章で「批判的なお店だけ外す」を確かめる。
// 実在の投稿には批判的なものが無かったため、作った見本で AI の論調の判定を見る。店名は架空。
import { config } from 'dotenv'
config({ path: '.env.local' })
import { anthropicClient, needsWorkspaceHeader } from '../src/lib/disaster-sns-road-ai'
import { buildCandidateShops, extractGourmet } from '../src/lib/gourmet-crawl'

const SAMPLES = [
  '#印西 ランチはしご3軒！①〇〇亭（印西市小林）唐揚げ定食が最高、また行きたい。②△△食堂（白井市）は正直がっかり。ぬるいし店員さんの態度も悪くて二度と行かないかな。③□□ベーカリー（印西牧の原）クロワッサンがサクサクで感動。',
  '#成田 期待して行った××ラーメン。スープがしょっぱすぎて半分残した。値段も高いし残念。',
  '【11/23開催】印西市民まつりに出店します！ キッチンカー5台が集まります。ぜひ遊びに来てください #印西 #イベント',
]

async function main() {
  let client = anthropicClient()
  for (const text of SAMPLES) {
    let r
    try { r = await extractGourmet(client, text) } catch (e) {
      if (!needsWorkspaceHeader(e)) throw e
      client = anthropicClient(true); r = await extractGourmet(client, text)
    }
    const cands = buildCandidateShops(r.extraction, [])
    console.log('---', text.slice(0, 30))
    console.log('食レポ', r.extraction.is_food_report, cands.map((c) => `${c.name}:${c.tone}→${c.status}`).join(' / '))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
