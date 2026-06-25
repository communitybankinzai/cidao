-- 修正: anon / authenticated / service_role ロールへの GRANT 不足を補正
--
-- 経緯: 初期 migration 20260624120001_rls_policies.sql で RLS は設定したが、
-- その前提となる GRANT SELECT/INSERT/UPDATE/DELETE が抜けていた。
-- 結果: Supabase 経由の全 REST/PostgREST 操作が「permission denied」を返し、
-- /me ページが「プロフィール取得に失敗」、seed script は DATABASE_URL 直接接続を強いられていた。
--
-- 標準的な Supabase テンプレートに揃える方針:
--   - anon: SELECT のみ（RLS でさらに行フィルタ）
--   - authenticated: SELECT/INSERT/UPDATE/DELETE 全て（RLS で行フィルタ）
--   - service_role: 全権限（RLS バイパス）

-- スキーマ自体の USAGE
grant usage on schema public to anon, authenticated, service_role;

-- 既存テーブルへの GRANT
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- 既存シーケンス（serial カラム等）への GRANT
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- 既存関数への GRANT
grant execute on all functions in schema public to anon, authenticated, service_role;

-- 今後 public schema に追加される新テーブル・シーケンス・関数への default privilege
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
