// avatars Storage バケットを作成 + RLS policy 設定
import { readFileSync } from 'node:fs'
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
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

console.log('avatars バケット作成 / 既存確認...')

// バケット作成（既存ならスキップ）
await client.query(`
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp','image/gif'])
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types
`)
console.log('  バケット OK (public, 2MB上限, jpg/png/webp/gif)')

// 既存 policy をクリーンに張り直し
await client.query(`drop policy if exists avatars_public_read on storage.objects`)
await client.query(`drop policy if exists avatars_user_insert on storage.objects`)
await client.query(`drop policy if exists avatars_user_update on storage.objects`)
await client.query(`drop policy if exists avatars_user_delete on storage.objects`)

// 誰でも公開読み取り
await client.query(`
  create policy avatars_public_read on storage.objects
    for select using (bucket_id = 'avatars')
`)

// 認証ユーザーは自分の UID プレフィックスのファイルのみ INSERT/UPDATE/DELETE
// 規約: 'avatars/{auth.uid}.ext' でアップロード
await client.query(`
  create policy avatars_user_insert on storage.objects
    for insert with check (
      bucket_id = 'avatars'
      and auth.uid()::text = split_part(name, '.', 1)
    )
`)
await client.query(`
  create policy avatars_user_update on storage.objects
    for update using (
      bucket_id = 'avatars'
      and auth.uid()::text = split_part(name, '.', 1)
    )
`)
await client.query(`
  create policy avatars_user_delete on storage.objects
    for delete using (
      bucket_id = 'avatars'
      and auth.uid()::text = split_part(name, '.', 1)
    )
`)
console.log('  policy 4本 OK (public read, user insert/update/delete)')

const r = await client.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='avatars'`)
console.log('結果:', r.rows[0])

await client.end()
