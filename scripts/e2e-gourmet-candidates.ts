// 食レポの SNS 巡回の承認・却下の通し試験（本番 DB・2026-11-13）。管理画面のボタンが呼ぶのと同じ処理を使う。
//   npx tsx scripts/e2e-gourmet-candidates.ts setup     … 試験の候補を2件入れて、承認・却下を通す
//   npx tsx scripts/e2e-gourmet-candidates.ts takedown  … 承認で地図に出た試験の食レポを伏せる（運営が伏せるのと同じ hidden=true）
//   npx tsx scripts/e2e-gourmet-candidates.ts cleanup   … 試験の食レポと候補を消す
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { approveShops, rejectCandidate, rejectShops, CandidateError } from '../src/lib/gourmet-candidates'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
const A = 'TEST-gourmet-crawl-A'
const B = 'TEST-gourmet-crawl-B'
const URL_A = 'https://www.instagram.com/p/TESTcrawlA01/'
const URL_B = 'https://www.instagram.com/p/TESTcrawlB01/'

async function shopRef(name: string) {
  const res = await fetch('https://communitybankinzai.github.io/cbi-site/gourmet-map/osm-shops.json')
  const shops = ((await res.json()) as { shops: Array<{ id: string; name: string; area: string }> }).shops
  const s = shops.find((x) => x.name === name)
  if (!s) throw new Error(`お店が無い: ${name}`)
  return { ref: s.id.toLowerCase(), name: s.name, area: s.area }
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'setup') {
    const miya = await shopRef('茶房 宮﨑邸')
    const base = { source: 'instagram-hashtag', platform: 'instagram', caption_hash: 'test', status: 'pending', model: 'test' }
    const shop = (name: string, ref: string | null, status: string) => ({ name, area_hint: '印西市', tone: 'positive', confidence: 'high', reason: '[試験]', matches: ref ? [{ ref, name, area: 'inzai', municipality: '印西市', score: 100 }] : [], chosen_ref: ref, status, decision: null, report_id: null })
    let r = await db.from('gourmet_candidates').insert({ ...base, post_id: A, post_url: URL_A, shops: [shop(miya.name, miya.ref, 'ok'), shop('（試験）地図にないお店', null, 'unmatched')] })
    if (r.error) throw r.error
    r = await db.from('gourmet_candidates').insert({ ...base, source: 'instagram-account', author_handle: 'chiba_mogu', post_id: B, post_url: URL_B, hold_reason: 'らいさんの確認待ち（試験）', shops: [shop(miya.name, miya.ref, 'ok')] })
    if (r.error) throw r.error
    const { data: rows } = await db.from('gourmet_candidates').select('id, post_id').in('post_id', [A, B])
    const idA = rows!.find((x) => x.post_id === A)!.id, idB = rows!.find((x) => x.post_id === B)!.id
    console.log('承認（A の1店目）', await approveShops(db, idA, [{ index: 0, ref: miya.ref }], null), '件')
    await rejectShops(db, idA, [1], null)
    const a = (await db.from('gourmet_candidates').select('status, shops').eq('id', idA).single()).data!
    console.log('A の状態', a.status, (a.shops as Array<{ decision: string }>).map((s) => s.decision))
    try { await approveShops(db, idB, [{ index: 0, ref: miya.ref }], null); console.log('×保留つきが承認できてしまった') } catch (e) { console.log('保留つき B の承認：', e instanceof CandidateError ? `断られた（${e.message}）` : e) }
    await rejectCandidate(db, idB, null)
    console.log('B の状態', (await db.from('gourmet_candidates').select('status').eq('id', idB).single()).data!.status)
    const rep = (await db.from('gourmet_reports').select('id, shop_ref, shop_name, source, multi_shop, is_own, image_url, comment, hidden').eq('url', URL_A)).data
    console.log('地図に入った食レポ', JSON.stringify(rep))
    console.log('B の URL の食レポ（0 のはず）', (await db.from('gourmet_reports').select('id').eq('url', URL_B)).data?.length)
  } else if (mode === 'takedown') {
    const { error } = await db.from('gourmet_reports').update({ hidden: true }).eq('url', URL_A)
    console.log('伏せた', error ? error.message : 'ok')
  } else if (mode === 'cleanup') {
    console.log('食レポを削除', (await db.from('gourmet_reports').delete().in('url', [URL_A, URL_B]).select('id')).data?.length)
    console.log('候補を削除', (await db.from('gourmet_candidates').delete().in('post_id', [A, B]).select('id')).data?.length)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
