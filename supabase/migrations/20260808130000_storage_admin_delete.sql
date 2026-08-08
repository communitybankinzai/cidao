-- =============================================================
-- 画像ストレージに運営（committee / super）用の削除権限を追加
--
-- 現状:
--   freefree-images / event-flyers / org-logos はいずれも public バケットで、
--   削除ポリシーが owner = auth.uid()（アップロードした本人）のみだった。
--   このため不適切な写真が投稿されても、運営は掲載を非公開にすることしかできず、
--   画像そのものは URL を知っていれば誰でも見られる状態のまま残っていた。
--
-- 対処:
--   3バケットに committee / super だけが使える DELETE ポリシーを足す。
--   service_role（RLS 全バイパス）を使う案もあったが、削除は戻せない操作なので
--   「誰が何を消せるか」を DB 側に明示できる RLS 方式を採る。
--
-- 注意:
--   Supabase の公開URLはCDNでキャッシュされるため、削除しても数分間（本プロジェクト
--   の cacheControl は 300 秒）は表示され続けることがある。
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
