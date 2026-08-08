-- =============================================================
-- 2026-08-08 分の未適用マイグレーション（Supabase SQL Editor に貼って実行）
--   supabase/migrations/20260808120000_freefree_admin_moderation.sql
--
-- FreeFree掲示板の運営モデレーション（非公開化）に必要。
-- 適用するまで /admin/freefree の一覧が読み込めません。
-- =============================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'freefree_posts'
       and policyname = 'freefree_update_admin'
  ) then
    create policy freefree_update_admin on public.freefree_posts
      for update using (public.is_committee_or_super())
      with check (public.is_committee_or_super());
  end if;
end $$;

alter table public.freefree_posts
  add column if not exists moderated_at     timestamptz,
  add column if not exists moderated_by     uuid references public.members(id),
  add column if not exists moderation_note  text;

comment on column public.freefree_posts.moderated_at is
  '運営が非公開にした日時。元に戻すと null に戻る。';
comment on column public.freefree_posts.moderation_note is
  '非公開にした理由（サンプル投稿の片付け／迷惑投稿 など）。掲載者や一般には表示しない。';

-- =============================================================
-- 確認クエリ。7月29日分（sns_display_name / sns_post_logs の承認）が
-- まだなら scripts/apply-20260729-freefree-sns.sql も先に流すこと。
-- 4 行返れば今回分＋7月29日分ともに適用済み。
-- =============================================================
-- select 'freefree_update_admin' as item from pg_policies
--  where tablename = 'freefree_posts' and policyname = 'freefree_update_admin'
-- union all
-- select 'moderation_note' from information_schema.columns
--  where table_name = 'freefree_posts' and column_name = 'moderation_note'
-- union all
-- select 'sns_display_name' from information_schema.columns
--  where table_name = 'freefree_posts' and column_name = 'sns_display_name'
-- union all
-- select 'sns_post_logs.approved_at' from information_schema.columns
--  where table_name = 'sns_post_logs' and column_name = 'approved_at';
