// 食レポの「地図にないお店」の住所調べを自動で回す（2026-11-13 事業主指示「地図を調べないといけないものは自動で住所を調べる流れにして」）。
//
// 1 回の実行でやること（Windows タスク「CBI-食レポ住所自動」が30分ごとに呼ぶ。cwd は C:\Repos\cidao）
//   A. 未処理の成果（Drive の Claude連絡/成果/NNN_お店の住所.json）があれば、位置を国土地理院で調べて、地図に足して承認する
//      - 登録する条件：営業中／住所あり／範囲の中（範囲外・閉店・移転・住所不明・確度低は登録せず、理由を残す）
//   B. 開いている依頼（成果待ち）が無く、地図にないお店（範囲外でない）が溜まっていれば、次の番号の依頼書を Drive に置く
//   Muse は夜に依頼を処理する（21:05〜22:50）。直接頼めば即実行されるが、ここでは自動化しない。
// 状態: CBI/scripts/_gourmet_address_auto_state.json ／ 通知文: _gourmet_address_auto_msg.txt（声は ps1 が読む）
// 使い方: npx tsx scripts/gourmet-address-auto.ts [--dry-run]（--dry-run は何も書かない）

import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { addShopAndApprove } from '../src/lib/gourmet-candidates'
import { hintAreaClass } from '../src/lib/gourmet-area-class'

const DRY = process.argv.includes('--dry-run')
const HOME = process.env.USERPROFILE ?? 'C:/Users/you08'
const SCRIPTS = `${HOME}/OneDrive/CBI/scripts`
const STATE = `${SCRIPTS}/_gourmet_address_auto_state.json`
const MSG = `${SCRIPTS}/_gourmet_address_auto_msg.txt`
const LOG = `${SCRIPTS}/_gourmet_address_auto.log`
const REQ_DIR = 'G:/マイドライブ/Claude連絡/依頼'
const OUT_DIR = 'G:/マイドライブ/Claude連絡/成果'
const STALE_DAYS = 3
// 成果の note / business_issue にこれらがあれば自動登録せず保留（食中毒などの営業上の問題）
const ISSUE_WORDS = ['食中毒', '営業停止', '営業禁止', '行政処分', '行政指導', '衛生上', '不祥事', '休業中', '営業を見合わせ']

type Target = { no: number; cid: string; idx: number; name: string; hint: string; post: string }
type Req = { number: string; createdAt: string; targets: Target[]; done: boolean; staleNotified?: boolean; results?: Array<{ name: string; outcome: string }> }
type State = { requests: Req[] }

function log(m: string) {
  const line = `${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })} ${m}\n`
  process.stdout.write(line)
  if (!DRY) appendFileSync(LOG, line, 'utf8')
}

function loadState(): State {
  return existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as State) : { requests: [] }
}
function saveState(s: State) {
  if (!DRY) writeFileSync(STATE, JSON.stringify(s, null, 1), 'utf8')
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const i = l.indexOf('=')
    if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return env
}

async function gsi(addr: string): Promise<{ lat: number; lon: number; title: string } | null> {
  try {
    const base = addr.split(/[ 　]/)[0]
    const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(base), { signal: AbortSignal.timeout(20_000) })
    const j = (await res.json()) as Array<{ geometry: { coordinates: [number, number] }; properties: { title?: string } }>
    if (!j.length) return null
    return { lat: j[0].geometry.coordinates[1], lon: j[0].geometry.coordinates[0], title: j[0].properties.title ?? '' }
  } catch {
    return null
  }
}

function requestMarkdown(number: string, targets: Target[]): string {
  const rows = targets.map((t) => `| ${t.no} | ${t.name} | ${t.hint.replace(/\|/g, '/')} | ${t.post} |`).join('\n')
  const n = targets.length
  return `# 依頼${number}：食レポマップに載せるお店${n}店の住所を調べてください

- 依頼日：${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}（自動で作った依頼。CiDAO の食レポ候補に、地図にまだ無いお店が出たとき）
- 実行できる日：今夜から
- 期限：作成から4日後の 22:50
- 種類：単発（番号つき）
- 成果：成果/${number}_お店の住所.json
- 返信：返信/${number}_Muse.md
- 事業主の指示：「地図を調べないといけないものは自動で住所を調べる流れにして」「わからないものは Muse に依頼してください」（2026-11-13）

## 目的
CiDAO の「ぐるめ」（食レポマップ）は、印西市と周辺6市町（白井市・栄町・柏市・我孫子市・成田市・佐倉市）のお店を地図に載せます。
SNS の投稿で紹介されたお店のうち、地図にまだ無い${n}店の「所在地（住所）」を、下の表から調べてください。住所が分かれば、パソコン側で位置に変換して地図に載せます（自動）。

## 調べてほしいこと（お店ごとに）
1. 正式な店名（投稿の表記と違えば、正しい方）
2. 所在地（住所）。県名から番地まで。例：千葉県印西市中央北1-4 アルカサール内
3. 営業しているか（営業中／閉店／移転／不明）
4. 出典のURL（お店の公式サイト・公式SNS・Googleマップ・食べログ・自治体や商工会のページなど）。1つ以上
5. 確度（高＝出典で住所が確かめられた／中＝出典はあるが番地が曖昧／低＝店名が一致するか自信がない）

## 守ること
- **推測で住所を作らない。** 分からない店は address を空文字にして、note に理由を書く（部分的な当て推量を入れない）
- 同じ名前のお店が複数あるとき（チェーン店など）は、下の「地域のヒント」と投稿の内容にいちばん近い店舗を選ぶ。選んだ理由を note に書く
- ホテルの中のレストランは、ホテルの住所を書く（note に「ホテル内」）
- 調べた結果、実際の所在地が上の7市町の外だと分かったら、その住所をそのまま書き、note に「範囲外」と書く
- 食中毒・営業停止・行政処分・衛生上の指摘・事故・不祥事など、営業上の問題が報じられている店は、business_issue に内容と出典を1行で書く（問題がなければ空文字）。書かれた店は自動登録されず、人が判断する
- 投稿のURLは、お店を特定する手がかりとして読んでよい（公開投稿）。個人の情報は、成果に書かない
- 調べるのに使えない（検索できない）ときは、成果物を置かず、返信にその理由を書く

## 調べるお店（${n}店）
| no | 店名（投稿から読み取った表記） | 地域のヒント | 紹介している投稿 |
|---|---|---|---|
${rows}

## 成果物の形式
- 保存先：成果/${number}_お店の住所.json（UTF-8 の JSON だけ。説明文・前置き・コードフェンスは入れない。保存前に JSON として正しいか自分で確かめる）
- 形：

{"items":[{"no":1,"name":"正式な店名","address":"千葉県印西市中央北1-4 アルカサール内","address_level":"番地","status":"営業中","source_urls":["https://…"],"confidence":"高","business_issue":"","note":""}]}

- items は上の表の${n}件すべてを、no の順に入れる（分からない店も入れる）
- address_level：番地（番地・号まで分かる）／町丁（町名・丁目まで）／不明
- status：営業中／閉店／移転／不明
- confidence：高／中／低
- 返信/${number}_Muse.md には、できた件数・分からなかった店・使った調べ方を書く
`
}

async function main() {
  const env = loadEnv()
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const state = loadState()
  const msgs: string[] = []

  // ---- A. 届いた成果を処理する ----
  for (const req of state.requests.filter((r) => !r.done)) {
    const file = `${OUT_DIR}/${req.number}_お店の住所.json`
    if (!existsSync(file)) {
      const ageDays = (Date.now() - new Date(req.createdAt).getTime()) / 86_400_000
      if (ageDays > STALE_DAYS && !req.staleNotified) {
        req.staleNotified = true
        msgs.push(`依頼${req.number}の住所調べに、${STALE_DAYS}日たっても Muse の返事がありません。Muse に直接頼むと、すぐ実行されます。`)
      }
      continue
    }
    let items: Array<Record<string, unknown>>
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      items = Array.isArray(j) ? j : j.items
      if (!Array.isArray(items)) throw new Error('items がない')
    } catch (e) {
      log(`依頼${req.number}の成果を読めません（書き込み途中かもしれない。次回に再試行）：${e instanceof Error ? e.message : e}`)
      continue
    }
    const results: Array<{ name: string; outcome: string }> = []
    let added = 0
    for (const t of req.targets) {
      const it = items.find((x) => Number(x.no) === t.no)
      const label = t.name
      if (!it) { results.push({ name: label, outcome: '成果に載っていない' }); continue }
      const address = String(it.address ?? '').trim()
      const note = String(it.note ?? '')
      const status = String(it.status ?? '')
      const conf = String(it.confidence ?? '')
      if (!address) { results.push({ name: label, outcome: `住所が分からない（${note.slice(0, 60)}）` }); continue }
      if (status === '閉店' || status === '移転') { results.push({ name: label, outcome: `${status}のため登録しない` }); continue }
      if (note.includes('範囲外')) { results.push({ name: label, outcome: '範囲外（印西市と周辺6市町の外）' }); continue }
      if (conf === '低') { results.push({ name: label, outcome: '確度が低いため登録しない' }); continue }
      const issue = String(it.business_issue ?? '').trim()
      const kw = ISSUE_WORDS.find((w) => note.includes(w) || issue.includes(w))
      if (issue || kw) { results.push({ name: label, outcome: `営業上の問題の記載があるため保留（${(issue || note).slice(0, 60)}）` }); continue }
      const g = await gsi(address)
      if (!g) { results.push({ name: label, outcome: `位置に変換できない（${address}）` }); continue }
      if (DRY) { results.push({ name: label, outcome: `（dry-run）登録できる：${address} → ${g.lat},${g.lon}` }); continue }
      try {
        const r = await addShopAndApprove(db, t.cid, t.idx, { name: String(it.name ?? t.name), address, lat: g.lat, lon: g.lon }, null)
        added += r.added
        results.push({ name: label, outcome: `承認（${r.reused ? '既存の店に付けた' : '新規登録'}・${address}）` })
      } catch (e) {
        results.push({ name: label, outcome: `登録できない：${e instanceof Error ? e.message : e}` })
      }
    }
    req.results = results
    if (!DRY) req.done = true
    for (const r of results) log(`依頼${req.number} ${r.name}：${r.outcome}`)
    const bad = results.filter((r) => !r.outcome.startsWith('承認'))
    msgs.push(`依頼${req.number}の住所調べが終わりました。${added}店を地図に載せました。` + (bad.length ? `${bad.length}店は載せていません。` : ''))
  }

  // ---- B. 次の依頼書を作る（開いている依頼が無いとき）----
  if (!state.requests.some((r) => !r.done)) {
    const requested = new Set(state.requests.flatMap((r) => r.targets.map((t) => `${t.cid}:${t.idx}`)))
    const { data } = await db.from('gourmet_candidates').select('id, post_url, shops').eq('status', 'pending')
    const targets: Target[] = []
    for (const c of data ?? []) {
      ;(c.shops as Array<Record<string, unknown>>).forEach((s, i) => {
        if (s.decision || s.status !== 'unmatched') return
        if (hintAreaClass(String(s.area_hint ?? '')) === 'out') return
        if (requested.has(`${c.id}:${i}`)) return
        targets.push({ no: targets.length + 1, cid: String(c.id), idx: i, name: String(s.name), hint: String(s.area_hint ?? ''), post: String(c.post_url) })
      })
    }
    if (targets.length) {
      const nums = readdirSync(REQ_DIR).map((f) => /^(\d{3})_/.exec(f)?.[1]).filter(Boolean).map(Number)
      const number = String(Math.max(0, ...nums) + 1).padStart(3, '0')
      if (!DRY) {
        writeFileSync(`${REQ_DIR}/${number}_お店の住所を調べてください.md`, requestMarkdown(number, targets), 'utf8')
        state.requests.push({ number, createdAt: new Date().toISOString(), targets, done: false })
      }
      log(`依頼${number}を Drive に置いた（${targets.length}店：${targets.map((t) => t.name).join('、')}）`)
    }
  }

  saveState(state)
  if (msgs.length && !DRY) {
    writeFileSync(MSG, '食レポマップの住所調べです。' + msgs.join(''), 'utf8')
    log('通知: ' + msgs.join(' '))
  }
  if (!msgs.length) log('動きなし')
}

main().catch((e) => {
  log('ERROR ' + (e instanceof Error ? e.stack : String(e)))
  process.exit(1)
})
