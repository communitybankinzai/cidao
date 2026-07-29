-- =============================================================
-- 2026-07-29 分の未適用マイグレーション（Supabase SQL Editor に貼って実行）
--
-- ⚠ 先に実行してください。適用するまで FreeFree の新規掲載が失敗します
--    （src/app/freefree/actions.ts が sns_display_name 列に書き込むため）。
--
-- 内訳:
--   1. freefree_posts.sns_display_name  … SNSで名指しに使う表示名
--   2. sns_post_logs の承認まわり        … 本文保存・承認・UPDATEポリシー
-- =============================================================

-- ---------- 1. supabase/migrations/20260729180000_freefree_sns_display_name.sql
alter table public.freefree_posts
  add column if not exists sns_display_name text
    check (sns_display_name is null or char_length(sns_display_name) between 1 and 40);

comment on column public.freefree_posts.sns_display_name is
  'SNS投稿で名指しに使う表示名（掲載者本人が入力したときのみ）。未入力なら活動そのものを主語にする。団体掲載では organizations.name を優先。';

-- ---------- 2. supabase/migrations/20260729190000_sns_post_approval.sql
alter table public.sns_post_logs
  add column if not exists content     text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.members(id);

comment on column public.sns_post_logs.content is
  '実際に配信する本文。運営が管理画面で確認・修正したもの。null なら未作成。';
comment on column public.sns_post_logs.approved_at is
  '運営が承認した日時。null の間は /api/sns/dispatch の対象外。';

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

-- ---------- 確認用（実行後に流すと 2 行返れば成功）
-- select column_name from information_schema.columns
--  where table_name = 'freefree_posts' and column_name = 'sns_display_name'
-- union all
-- select policyname from pg_policies
--  where tablename = 'sns_post_logs' and policyname = 'sns_logs_update_admin';
