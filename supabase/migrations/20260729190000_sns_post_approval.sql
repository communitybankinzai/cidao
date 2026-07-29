-- =============================================================
-- SNS投稿の運営事前承認（開発仕様書 v2.1 §3.11.4「立ち上げ期：運営事前承認」）
--
-- これまで投稿本文は配信時に毎回テンプレートから組み立てており、人が目で見て
-- 直す手段がなかった。本文を sns_post_logs に保存し、運営が確認・修正・承認した
-- ものだけを実際に配信する。
--
-- あわせて UPDATE ポリシーを追加する。sns_post_logs は RLS 有効だが SELECT の
-- ポリシーしか無く、/api/sns/dispatch の markLog() による status 更新が 0 行に
-- なっていた。このため投稿が成功しても行は pending のまま残り、次回の dispatch で
-- 同じ内容が再送される状態だった（認証情報が未設定で実投稿されていないため
-- 顕在化していなかった）。承認機能にも UPDATE が要るので同時に直す。
-- =============================================================

alter table public.sns_post_logs
  add column if not exists content     text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.members(id);

comment on column public.sns_post_logs.content is
  '実際に配信する本文。運営が管理画面で確認・修正したもの。null なら未作成。';
comment on column public.sns_post_logs.approved_at is
  '運営が承認した日時。null の間は /api/sns/dispatch の対象外。';

-- 承認済みで未送信のものを dispatch が拾うための索引
create index if not exists idx_sns_logs_dispatchable
  on public.sns_post_logs (status, approved_at)
  where status = 'pending';

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'sns_post_logs'
       and policyname = 'sns_logs_update_admin'
  ) then
    create policy sns_logs_update_admin on public.sns_post_logs
      for update using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;
