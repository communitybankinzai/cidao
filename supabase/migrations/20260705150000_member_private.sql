-- =============================================================
-- member_private: 会員の非公開情報（実名）
-- 設計:
--   - members に列追加すると members_select_others ポリシーで全ログイン会員に
--     露出するため、本人のみ読める別テーブルに分離する
--   - 受付（reception）では server action（service_role）経由でのみ参照し、
--     受付担当者の画面にだけ表示する
-- =============================================================

create table public.member_private (
  member_id  uuid primary key references public.members(id) on delete cascade,
  real_name  text check (char_length(real_name) <= 50),
  updated_at timestamptz not null default now()
);

alter table public.member_private enable row level security;

-- 本人のみ読み書き可（+ 管理者は閲覧可）
create policy member_private_select_own on public.member_private
  for select using (member_id = auth.uid() or public.is_admin());

create policy member_private_insert_own on public.member_private
  for insert with check (member_id = auth.uid());

create policy member_private_update_own on public.member_private
  for update using (member_id = auth.uid());
