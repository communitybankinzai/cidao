// match-orgs 動作確認スクリプト
// 1. 興味分野付きのテストメンバーを 1 件作成
// 2. cidao.vercel.app/api/ai/match-orgs に POST
// 3. 結果を表示
// 4. テストメンバーを削除（cleanup）

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const envPath = join(__dirname, '..', '.env.local')
  const content = readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
    env[k] = v
  }
  return env
}

const env = loadEnvLocal()
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const pgClient = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  await pgClient.connect()

  const interestsCandidates = ['kankyo', 'kodomo', 'bunka']
  console.log(`テスト interests: ${interestsCandidates.join(', ')}`)

  // 1. 既存テストメンバー削除
  const testEmail = 'matchtest@cidao.internal'
  const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existing = listed.data?.users?.find((u) => u.email === testEmail)
  if (existing) {
    console.log(`[cleanup] 既存テストメンバー削除: ${existing.id}`)
    await pgClient.query('DELETE FROM public.members WHERE id = $1', [existing.id])
    await supabase.auth.admin.deleteUser(existing.id)
  }

  // 2. 新規テストメンバー作成
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: testEmail,
    email_confirm: true,
  })
  if (createErr) throw new Error(`auth.admin.createUser 失敗: ${createErr.message}`)
  const testMemberId = created.user.id
  console.log(`[create] テストメンバー: ${testMemberId}`)

  // auth.users → members 自動行作成トリガーがあるため UPDATE で interests を埋める
  await pgClient.query(
    `UPDATE public.members
     SET display_name = $2, residency_type = $3, tier = $4, interests = $5, self_introduction = $6
     WHERE id = $1`,
    [
      testMemberId,
      '【テスト】マッチング検証用',
      'citizen',
      'light',
      interestsCandidates,
      '環境問題と子ども教育に関心があります。地域の里山保全活動や子ども向けの環境学習プロジェクトに参加したいと思っています。',
    ],
  )

  // 3. match-orgs API 呼び出し
  console.log(`\n[POST] cidao.vercel.app/api/ai/match-orgs`)
  const res = await fetch('https://cidao.vercel.app/api/ai/match-orgs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: testMemberId }),
  })
  const result = await res.json()
  console.log(`HTTP ${res.status}`)
  console.log(JSON.stringify(result, null, 2))

  // 4. 結果が match を含むなら、org name も解決して表示
  if (result.matches?.length > 0) {
    console.log('\n=== マッチした団体（name 解決） ===')
    const ids = result.matches.map((m) => m.org_id)
    const orgs = await pgClient.query(
      'SELECT id, name FROM public.organizations WHERE id = ANY($1)',
      [ids],
    )
    const nameById = new Map(orgs.rows.map((r) => [r.id, r.name]))
    for (const m of result.matches) {
      console.log(`  - ${nameById.get(m.org_id) ?? '(?)'} / score=${m.score} / reason="${m.reason ?? ''}"`)
    }
  }

  // 5. cleanup
  console.log(`\n[cleanup] テストメンバー削除`)
  await pgClient.query('DELETE FROM public.members WHERE id = $1', [testMemberId])
  await supabase.auth.admin.deleteUser(testMemberId)

  await pgClient.end()
  console.log('\n完了')
}

main().catch(async (err) => {
  console.error('FATAL:', err)
  try { await pgClient.end() } catch {}
  process.exit(1)
})
