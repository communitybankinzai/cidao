// 単一の migration SQL を本番 DB に適用する小スクリプト
// 用途: supabase CLI が手元にない環境で簡易適用
// Usage: node scripts/apply-migration.mjs <migration-file>

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

const migrationPath = process.argv[2]
if (!migrationPath) {
  console.error('Usage: node scripts/apply-migration.mjs <migration-file>')
  process.exit(1)
}

const env = loadEnvLocal()
const sql = readFileSync(migrationPath, 'utf8')
console.log(`migration: ${migrationPath}`)
console.log(`bytes: ${sql.length}`)
console.log('--- SQL ---')
console.log(sql)
console.log('-----------')

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('✅ migration 適用成功')
} catch (err) {
  await client.query('ROLLBACK')
  console.error('❌ migration 失敗:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
