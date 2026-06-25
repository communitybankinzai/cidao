// DB レイヤーの検証：投入された org データが match-orgs の前提条件を満たすか確認

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const c = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
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

const env = loadEnvLocal()
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

await client.connect()

console.log('=== organizations 集計 ===')
const total = await client.query('SELECT COUNT(*) AS n, type, public_flag FROM public.organizations GROUP BY type, public_flag ORDER BY type')
console.table(total.rows)

console.log('\n=== organization_categories 分布 ===')
const cats = await client.query(`
  SELECT category, COUNT(*) AS n
  FROM public.organization_categories
  GROUP BY category
  ORDER BY n DESC
`)
console.table(cats.rows)

console.log('\n=== シミュレーション: interests=[kankyo,kodomo,bunka] のメンバーが見る overlap 上位 10 件 ===')
const overlap = await client.query(`
  SELECT o.name, o.type,
         array_agg(DISTINCT oc.category) AS categories,
         COUNT(DISTINCT oc.category) AS overlap_count
  FROM public.organizations o
  JOIN public.organization_categories oc ON oc.org_id = o.id
  WHERE oc.category = ANY($1::text[])
    AND o.public_flag = true
  GROUP BY o.id, o.name, o.type
  ORDER BY overlap_count DESC, o.name
  LIMIT 10
`, [['kankyo', 'kodomo', 'bunka']])
console.table(overlap.rows)

console.log('\n=== シミュレーション: interests=[bosai] のメンバーが見る overlap ===')
const bosai = await client.query(`
  SELECT o.name
  FROM public.organizations o
  JOIN public.organization_categories oc ON oc.org_id = o.id
  WHERE oc.category = 'bosai'
    AND o.public_flag = true
  ORDER BY o.name
  LIMIT 10
`)
console.table(bosai.rows)

console.log('\n=== システムプレースホルダーメンバー確認 ===')
const sysMember = await client.query(`
  SELECT id, display_name, tier, residency_type,
         (SELECT COUNT(*) FROM public.organizations WHERE representative_id = m.id) AS orgs_count
  FROM public.members m
  WHERE display_name = '印西市公式登録（未認証プレースホルダー）'
`)
console.table(sysMember.rows)

await client.end()
console.log('\n完了')
