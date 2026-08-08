-- =============================================================
-- 2026-08-08 分（その2）（Supabase SQL Editor に貼って実行）
--   supabase/migrations/20260808130000_storage_admin_delete.sql
--
-- 運営（committee / super）が画像ストレージから不適切な画像を削除できるようにする。
-- 適用するまで管理画面の「画像だけ削除」は権限エラーになります。
--
-- ※ 同日の 20260808120000（FreeFree管理画面）も未適用なら
--    scripts/apply-20260808-freefree-moderation.sql を先に流してください。
-- =============================================================

do $$
declare
  v_bucket text;
begin
  foreach v_bucket in array array['freefree-images', 'event-flyers', 'org-logos'] loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname = v_bucket || '_admin_delete'
    ) then
      execute format(
        'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_committee_or_super())',
        v_bucket || '_admin_delete',
        v_bucket
      );
    end if;
  end loop;
end $$;

-- 確認（3行返れば適用済み）
-- select policyname from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname like '%_admin_delete';
