// 印西の市民活動団体（inzaiparque 取込で 1 行説明しかない）を
// Web 検索＋Claude で {公式サイト・SNSリンク・長文活動説明・活動エリア} を構造化抽出して
// organizations の新規列に provisional 保存するパイプライン。
//
// 使い方：
//   node scripts/enrich-organizations.mjs --limit 3              # まず 3 件で精度確認
//   node scripts/enrich-organizations.mjs --limit 3 --dry-run    # DB 書き込みなし
//   node scripts/enrich-organizations.mjs --org <UUID>           # 特定 1 件
//   node scripts/enrich-organizations.mjs --all                  # 未拡充 全件
//   node scripts/enrich-organizations.mjs --reenrich --limit 3   # enriched_at があっても再実行
//
// モデルは claude-haiku-4-5（コスト重視）。web_search_20250305（basic 版）を使用。
// 1件あたり ~$0.01-0.03 想定（220件で $2-7）。

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import pg from 'pg'
import Anthropic from '@anthropic-ai/sdk'

// ---- env -------------------------------------------------------
function loadEnv() {
  const c = readFileSync('.env.local', 'utf8')
  const env = {}
  for (const line of c.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return env
}

// ---- args ------------------------------------------------------
const args = process.argv.slice(2)
function hasFlag(name) { return args.includes(`--${name}`) }
function argValue(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}

const OPT = {
  limit: Number(argValue('limit') || 3),
  org: argValue('org'),
  all: hasFlag('all'),
  reenrich: hasFlag('reenrich'),
  dryRun: hasFlag('dry-run'),
  sleepMs: Number(argValue('sleep') || 1500),
}

// ---- env / clients --------------------------------------------
const env = loadEnv()
if (!env.DATABASE_URL) { console.error('DATABASE_URL 未設定'); process.exit(1) }
if (!env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY 未設定'); process.exit(1) }

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

// ---- 対象団体取得 ---------------------------------------------
let orgs
if (OPT.org) {
  const r = await db.query(`SELECT id, name, type, description, website_url, sns_links FROM public.organizations WHERE id = $1`, [OPT.org])
  orgs = r.rows
} else {
  const where = OPT.reenrich ? '' : 'WHERE enriched_at IS NULL'
  const limit = OPT.all ? '' : `LIMIT ${OPT.limit}`
  const r = await db.query(`
    SELECT id, name, type, description, website_url, sns_links
    FROM public.organizations
    ${where}
    ORDER BY created_at ASC
    ${limit}
  `)
  orgs = r.rows
}
console.log(`対象団体: ${orgs.length}件 (${OPT.dryRun ? 'DRY-RUN' : 'WRITE'})\n`)

// ---- 構造化抽出ツール（strict）-------------------------------
const SUBMIT_TOOL = {
  name: 'submit_enrichment',
  description:
    '団体について Web 検索で集めた情報を構造化して提出する。' +
    '判明しなかったフィールドは null（文字列）/ {}（オブジェクト）/ "unknown"（活動エリア）でよい。' +
    '推測で埋めるのではなく、出典のある事実のみを記載する。',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      website_url: {
        type: ['string', 'null'],
        description: '団体公式サイトの URL（http/https）。SNSアカウントURLはここに入れず sns_links に入れる。なければ null。',
      },
      sns_links: {
        type: 'object',
        additionalProperties: false,
        description: '判明した SNS アカウントの URL。それぞれ無い場合は省略可。',
        properties: {
          x: { type: ['string', 'null'], description: 'X (Twitter) アカウントURL' },
          facebook: { type: ['string', 'null'], description: 'Facebookページ/アカウントURL' },
          instagram: { type: ['string', 'null'], description: 'InstagramアカウントURL' },
          youtube: { type: ['string', 'null'], description: 'YouTubeチャンネルURL' },
          line: { type: ['string', 'null'], description: 'LINE 公式アカウントURL' },
          note: { type: ['string', 'null'], description: 'note アカウントURL' },
          blog: { type: ['string', 'null'], description: 'ブログ（Amebaなど）URL' },
        },
      },
      activity_detail: {
        type: ['string', 'null'],
        description:
          '団体の活動内容を 200〜600 文字程度の日本語で詳しく記述する。' +
          '事業内容・主な活動・対象地域・実績・特徴などを盛り込む。' +
          '誇張せず、出典に基づいた事実のみ。情報が薄ければ短くてよい。判明しなければ null。',
      },
      activity_area: {
        type: 'string',
        description: '主な活動エリア。例：印西市内全域、印西市中央部、千葉県北総地域、全国、オンライン中心、不明 など。',
      },
      contact_email: {
        type: ['string', 'null'],
        description: '公式に公開されている連絡先メールアドレス（あれば）',
      },
      contact_url: {
        type: ['string', 'null'],
        description: '問い合わせフォーム等の URL（あれば）',
      },
      sources: {
        type: 'array',
        description: '抽出に使った主な出典 URL（取得できたページ）。最大5件。それ以上見つかっても重要なものから5件のみ。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string' },
            note: { type: 'string', description: '何を参照したか短いメモ（例：公式トップ、活動紹介、団体一覧）' },
          },
          required: ['url', 'note'],
        },
      },
      notes: {
        type: ['string', 'null'],
        description: '抽出時の注意・確信度の低い点・候補が複数あった場合などの短いメモ',
      },
    },
    required: [
      'website_url', 'sns_links', 'activity_detail', 'activity_area',
      'contact_email', 'contact_url', 'sources', 'notes',
    ],
  },
}

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
}

const SYSTEM = `あなたは印西市の市民活動団体に関する公開情報を Web から収集して構造化する調査アシスタントです。

タスク：与えられた団体について web_search を 2〜4 回程度使い、公式サイト・SNS・活動内容を調べ、最後に submit_enrichment ツールを必ず1回呼んで結果を提出してください。

検索戦略：
1. まず団体名そのままで検索（必要に応じて "印西" / "市民活動" を補う）
2. 公式サイトらしき候補が出たらドメイン名で再検索（SNSリンクを見つける）
3. 印西市市民活動センター（inzai-cac.org）に該当団体ページがあれば優先的に参照
4. inzaiparque.com のページは元データなのでそれ "以外" の情報源を優先

注意：
- 同名の別団体（特に他自治体の団体）を取り違えないこと。印西市の団体であることを必ず確認する
- 確信が持てない情報は null にして notes に書く。推測で埋めない
- SNS アカウントは「その団体本人のアカウント」と確信できるもののみ
- 出典 URL は必ず実際に web_search で見つけたものを sources に入れる`

// ---- 1団体ぶんを処理 -----------------------------------------
async function enrichOne(org) {
  const userPrompt =
    `団体名: ${org.name}\n` +
    `種別: ${org.type === 'civic' ? '市民活動団体（印西市登録）' : '任意団体'}\n` +
    `既存の短い説明: ${org.description || '(なし)'}\n\n` +
    `この団体について Web 検索で公式サイト・SNS・活動詳細を調べ、最後に必ず submit_enrichment を呼んで提出してください。`

  let resp
  try {
    resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM,
      tools: [WEB_SEARCH_TOOL, SUBMIT_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: userPrompt }],
    })
  } catch (e) {
    console.error(`  ✗ API エラー: ${e.message}`)
    return { ok: false, reason: 'api_error' }
  }

  // submit_enrichment の tool_use ブロックを探す
  const submit = resp.content.find((b) => b.type === 'tool_use' && b.name === 'submit_enrichment')
  const usage = resp.usage
  const cost =
    ((usage.input_tokens || 0) * 1 + (usage.output_tokens || 0) * 5) / 1_000_000

  if (!submit) {
    console.error(`  ✗ submit_enrichment が呼ばれなかった (stop_reason=${resp.stop_reason}, tokens in/out=${usage.input_tokens}/${usage.output_tokens}, $${cost.toFixed(4)})`)
    return { ok: false, reason: 'no_tool_call' }
  }

  return { ok: true, data: submit.input, usage, cost }
}

// ---- DB 更新（空欄のみ補完）----------------------------------
async function writeBack(org, ext) {
  const cleanUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : null)
  const snsClean = {}
  for (const [k, v] of Object.entries(ext.sns_links || {})) {
    const c = cleanUrl(v)
    if (c) snsClean[k] = c
  }

  // 空欄のみ補完（既存のユーザー入力を上書きしない）
  const updates = []
  const params = []
  let n = 1
  function set(col, val) {
    updates.push(`${col} = $${n++}`)
    params.push(val)
  }

  if (!org.website_url && cleanUrl(ext.website_url)) set('website_url', cleanUrl(ext.website_url))
  if ((!org.sns_links || Object.keys(org.sns_links).length === 0) && Object.keys(snsClean).length > 0) set('sns_links', JSON.stringify(snsClean))
  if (ext.activity_detail && ext.activity_detail.length >= 30) set('activity_detail', ext.activity_detail)
  if (ext.activity_area) set('activity_area', ext.activity_area)
  if (ext.contact_email && /@/.test(ext.contact_email)) set('contact_email', ext.contact_email)
  if (ext.contact_url && cleanUrl(ext.contact_url)) set('contact_url', cleanUrl(ext.contact_url))

  // メタデータは常に更新
  set('enriched_at', new Date().toISOString())
  set('enrichment_source', JSON.stringify({
    model: 'claude-haiku-4-5',
    fetched_at: new Date().toISOString(),
    sources: ext.sources || [],
    notes: ext.notes || null,
    proposed: {
      website_url: ext.website_url,
      sns_links: ext.sns_links,
      activity_detail_len: ext.activity_detail?.length || 0,
      activity_area: ext.activity_area,
      contact_email: ext.contact_email,
      contact_url: ext.contact_url,
    },
  }))
  set('info_verified', false)

  params.push(org.id)
  const sql = `UPDATE public.organizations SET ${updates.join(', ')} WHERE id = $${n}`
  await db.query(sql, params)
}

// ---- メインループ --------------------------------------------
let totalCost = 0
let okCount = 0
let failCount = 0

for (const [i, org] of orgs.entries()) {
  console.log(`[${i + 1}/${orgs.length}] ${org.name}`)
  const r = await enrichOne(org)
  if (!r.ok) { failCount++; if (i < orgs.length - 1) await sleep(OPT.sleepMs); continue }

  totalCost += r.cost
  okCount++
  const d = r.data
  console.log(`  ✓ tokens in/out=${r.usage.input_tokens}/${r.usage.output_tokens} $${r.cost.toFixed(4)} (累計 $${totalCost.toFixed(4)})`)
  console.log(`    website: ${d.website_url || '(なし)'}`)
  console.log(`    sns: ${Object.keys(d.sns_links || {}).filter((k) => d.sns_links[k]).join(',') || '(なし)'}`)
  console.log(`    activity_detail: ${(d.activity_detail || '').slice(0, 80)}${(d.activity_detail || '').length > 80 ? '…' : ''}`)
  console.log(`    activity_area: ${d.activity_area}`)
  console.log(`    sources: ${(d.sources || []).length}件`)

  if (!OPT.dryRun) {
    try {
      await writeBack(org, d)
      console.log(`    💾 DB更新`)
    } catch (e) {
      console.error(`    ✗ DB更新失敗: ${e.message}`)
    }
  }

  if (i < orgs.length - 1) await sleep(OPT.sleepMs)
}

console.log(`\n=== 完了 ===`)
console.log(`成功: ${okCount}件 / 失敗: ${failCount}件 / 合計コスト: $${totalCost.toFixed(4)}`)
if (orgs.length > 0) {
  console.log(`平均: $${(totalCost / Math.max(okCount, 1)).toFixed(4)}/件 → 全220件想定: $${((totalCost / Math.max(okCount, 1)) * 220).toFixed(2)}`)
}

await db.end()
