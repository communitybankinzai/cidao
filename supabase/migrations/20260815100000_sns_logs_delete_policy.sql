-- =============================================================
-- SNS下書きの却下（削除）を管理者に許可する
--
-- 承認しない下書きをリストから消せるようにする（管理画面の「却下」ボタン）。
-- 対象は未配信（pending）のみ。配信済み・失敗ログは監査のため削除不可。
-- =============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'sns_post_logs'
       and policyname = 'sns_logs_delete_admin'
  ) then
    create policy sns_logs_delete_admin on public.sns_post_logs
      for delete using (public.is_admin() and status = 'pending');
  end if;
end $$;

grant delete on public.sns_post_logs to authenticated;
