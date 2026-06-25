// CiDAO seed: 印西市市民活動団体（inzaiparque.com 抽出）の bulk insert
//
// Usage:
//   node scripts/seed-orgs.mjs           # dry-run（DB に書かない、内容と件数表示のみ）
//   node scripts/seed-orgs.mjs --apply   # 本実行（DB に書き込む、要 SUPABASE_SERVICE_ROLE_KEY）
//
// 動作：
//   1. システムプレースホルダーメンバー（auth.users + members）を idempotent に作成
//      - email: system-placeholder@cidao.internal
//      - tier: verified, display_name: "印西市公式登録（未認証プレースホルダー）"
//   2. seed-orgs-data.json の orgs[] を 1 件ずつ：
//      - sourceCategory → cidao categories[] にマッピング
//      - name から organization_type を推定（NPO法人系 → civic、町内会系・他 → voluntary）
//      - 既存（name 一致）はスキップ、無ければ insert
//      - organization_categories に category 行を upsert
//
// 環境変数（cidao/.env.local から自動 load）：
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

const APPLY = process.argv.includes('--apply')

// .env.local の手動 load（Next.js の dotenv に依存しない、独立スクリプト）
function loadEnvLocal() {
  const envPath = join(__dirname, '..', '.env.local')
  const content = readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

const env = loadEnvLocal()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const DATABASE_URL = env.DATABASE_URL

if (!SUPABASE_URL || !SERVICE_KEY || !DATABASE_URL) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL missing in .env.local')
  process.exit(1)
}

// Supabase SDK は auth admin（auth.users 操作）用
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// pg.Client は通常テーブル操作用（postgres ロール → RLS バイパス + 全権限）
const pgClient = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

// PROPOSAL_CATEGORIES（9 キー + other）への mapping
function mapCategories(sourceCategory) {
  const map = {
    '街づくり・地域活性化': ['machizukuri'],
    '印西の伝統文化保存': ['bunka'],
    '里山・自然・環境': ['kankyo'],
    '印西市PR活動': ['machizukuri'],
    '芸術・音楽・エンターテインメント': ['bunka'],
    'ふれあい・居場所・笑顔・つながり': ['fukushi'],
    '奉仕活動': ['other'],
    '食・食育': ['kodomo', 'sangyo'],
    '健康・メンタルヘルス': ['fukushi'],
    '学習・スキルアップ': ['kodomo'],
    '社会活動': ['other'],
    '社会・世界': ['tabunka'],
    '福祉サポート': ['fukushi'],
    'スポーツ': ['bunka'],
    '動物': ['other'],
    '出産・産後': ['fukushi', 'kodomo'],
    '子育てサポート': ['kodomo'],
    '子ども成長サポート': ['kodomo'],
    '子どもと芸術・スキルアップ・社会活動': ['kodomo', 'bunka'],
    'シニアライフ': ['fukushi'],
    '地元・町内会・自治会': ['machizukuri'],
    '防災・救援・地域安全': ['bosai'],
  }
  return map[sourceCategory] ?? ['other']
}

// organization_type 推定
function classifyType(name) {
  if (/^(NPO法人|特定非営利活動法人|一般社団法人|社団法人)/.test(name)) return 'civic'
  return 'voluntary'
}

// description 生成（元情報 + claim 案内）
function buildDescription(orig, sourceCategory) {
  const base = orig || '（未掲載）'
  return (
    `${base}\n\n` +
    `※ 印西市の市民活動団体登録情報を inzaiparque.com から抽出した暫定データです。代表者の方は claim 機能（準備中）から正式情報への更新をお待ちしています。\n` +
    `参照分野: ${sourceCategory}`
  )
}

// システムプレースホルダーメンバーを idempotent に作成、その UUID を返す
async function ensureSystemMember() {
  const email = 'system-placeholder@cidao.internal'

  // 1) 既存検索（email で auth.users → list）
  const { data: existingList, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listErr) throw new Error(`auth.admin.listUsers 失敗: ${listErr.message}`)
  const existing = existingList?.users?.find((u) => u.email === email)

  let userId
  if (existing) {
    userId = existing.id
    console.log(`[system-member] 既存を再利用: ${userId}`)
  } else {
    if (!APPLY) {
      console.log(`[system-member] (dry-run) 新規作成予定: email=${email}`)
      return 'DRY-RUN-PLACEHOLDER-UUID'
    }
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { role: 'system-placeholder', purpose: 'inzai-public-org-seed' },
    })
    if (createErr) throw new Error(`auth.admin.createUser 失敗: ${createErr.message}`)
    userId = created.user.id
    console.log(`[system-member] 新規作成: ${userId}`)
  }

  // 2) public.members に upsert（id = auth.users.id）— pg 経由（RLS バイパス）
  if (APPLY) {
    await pgClient.query(
      `INSERT INTO public.members (id, display_name, residency_type, tier, interests, contact_permission, ranking_opt_in, self_introduction, auth_provider_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, tier = EXCLUDED.tier, self_introduction = EXCLUDED.self_introduction, updated_at = now()`,
      [
        userId,
        '印西市公式登録（未認証プレースホルダー）',
        'citizen',
        'verified',
        [],
        false,
        false,
        'システム生成のプレースホルダーアカウント。inzaiparque.com 抽出データで作成された未認証団体の代表者欄を埋めるためのもの。各団体は代表者による claim を待っている状態。',
        'email',
      ],
    )
  }

  return userId
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (DB 書き込み有)' : 'DRY-RUN（DB 書き込み無）'}`)
  console.log(`Supabase URL: ${SUPABASE_URL}`)
  console.log('')

  const dataPath = join(__dirname, 'seed-orgs-data.json')
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  console.log(`データソース: ${data._source}`)
  console.log(`組織数: ${data.orgs.length}`)
  console.log('')

  // カテゴリ分布表示
  const categoryDist = {}
  const typeDist = { voluntary: 0, civic: 0 }
  for (const org of data.orgs) {
    const cats = mapCategories(org.sourceCategory)
    for (const c of cats) categoryDist[c] = (categoryDist[c] ?? 0) + 1
    typeDist[classifyType(org.name)]++
  }
  console.log('cidao カテゴリ分布:')
  for (const [c, n] of Object.entries(categoryDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`)
  }
  console.log('type 分布:')
  for (const [t, n] of Object.entries(typeDist)) {
    console.log(`  ${t}: ${n}`)
  }
  console.log('')

  // pg 接続
  if (APPLY) {
    await pgClient.connect()
    console.log('[pg] connected via DATABASE_URL')
    console.log('')
  }

  // システムメンバー
  const systemMemberId = await ensureSystemMember()
  console.log(`system_member_id: ${systemMemberId}`)
  console.log('')

  // 投入
  let inserted = 0
  let skipped = 0
  let failed = 0
  for (const org of data.orgs) {
    const cats = mapCategories(org.sourceCategory)
    const type = classifyType(org.name)
    const description = buildDescription(org.shortDescription, org.sourceCategory)

    if (APPLY) {
      try {
        // name による既存チェック（idempotent）
        const existing = await pgClient.query(
          'SELECT id FROM public.organizations WHERE name = $1 LIMIT 1',
          [org.name],
        )
        if (existing.rows.length > 0) {
          skipped++
          continue
        }

        const ins = await pgClient.query(
          `INSERT INTO public.organizations (name, type, description, representative_id, accept_messages, public_flag)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [org.name, type, description, systemMemberId, false, true],
        )
        const orgId = ins.rows[0].id

        for (let i = 0; i < cats.length; i++) {
          await pgClient.query(
            `INSERT INTO public.organization_categories (org_id, category, is_primary)
             VALUES ($1, $2, $3)
             ON CONFLICT (org_id, category) DO NOTHING`,
            [orgId, cats[i], i === 0],
          )
        }
        inserted++
      } catch (err) {
        console.error(`  ✗ [${org.name}] insert 失敗: ${err.message}`)
        failed++
      }
    } else {
      // dry-run
      inserted++
    }
  }

  if (APPLY) await pgClient.end()

  console.log('')
  console.log('=== 結果 ===')
  console.log(`挿入: ${inserted}`)
  console.log(`スキップ（既存）: ${skipped}`)
  console.log(`失敗: ${failed}`)
  if (!APPLY) {
    console.log('')
    console.log('※ dry-run のため DB には書き込まれていません。本実行は `node scripts/seed-orgs.mjs --apply`')
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
