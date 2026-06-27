// CBI のロゴ（site/assets/cbi-logo.png）を Supabase Storage 'org-logos' バケットに
// アップロードして organizations.logo_url にセット。
// 他団体のロゴアップロードは UI（/orgs/[id]/edit）から代表者が行う運用。

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

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

const env = loadEnv()
const LOGO_PATH = String.raw`C:\Users\you08\OneDrive\CBI\site\assets\cbi-logo.png`
const CBI_ORG_ID = '7ae8dd32-3f08-44fa-a65e-0a8337fa78ad'

// service_role が必要（RLS 通さない upload のため）
// Vercel の SUPABASE_SERVICE_ROLE_KEY は Sensitive で取れていないが、
// .env.local の SUPABASE_SERVICE_ROLE_KEY が空なら publishable で試す → 失敗したら DB 直接で URL セットのみ
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !KEY) {
  console.error('SUPABASE_URL or KEY 未設定')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, KEY)
const file = readFileSync(LOGO_PATH)
console.log(`ファイル: ${LOGO_PATH} (${file.length} bytes)`)

const storagePath = `cbi-${CBI_ORG_ID}.png`
console.log(`Storage path: org-logos/${storagePath}`)

// 既存ファイルは上書き
const { error: uploadErr } = await supabase.storage
  .from('org-logos')
  .upload(storagePath, file, {
    contentType: 'image/png',
    upsert: true,
  })

if (uploadErr) {
  console.error('upload 失敗（Storage RLS が原因なら DB 経由で URL セットのみ実行）:', uploadErr.message)
  // Storage は service_role が無いとアップロード不可なケースがある。
  // ファイルは既に手動でアップロードされている前提で、URL だけ DB にセットする path も用意
  console.log('\n→ DB だけ URL セットを試みます（手動アップロード前提）')
} else {
  console.log('✓ Storage アップロード成功')
}

const { data: urlData } = supabase.storage.from('org-logos').getPublicUrl(storagePath)
console.log(`公開URL: ${urlData.publicUrl}`)

// DB の logo_url を更新（プーラー経由 / RLS 回避のため直接 pg）
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const r = await db.query(
  'UPDATE public.organizations SET logo_url = $1 WHERE id = $2 RETURNING name, logo_url',
  [urlData.publicUrl, CBI_ORG_ID],
)
if (r.rowCount === 0) {
  console.error('✗ CBI org が見つからない')
  process.exit(1)
}
console.log(`✓ DB UPDATE: ${r.rows[0].name} → logo_url = ${r.rows[0].logo_url}`)
await db.end()
