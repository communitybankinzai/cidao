-- 機能追加:
-- 1. members.avatar_url （プロフィール画像 URL、Supabase Storage の avatars バケットを想定）
-- 2. 団体登録のハードル緩和: tier='verified' → 'email_only' 以上で登録可能に。
--    新規団体は public_flag=false（非公開）で作成され、管理者が承認すると公開される。
-- 3. memberships の RLS 追加: 自分が representative の org への status='confirmed' 自己 INSERT を許可
--    （createOrganization の挙動が現状 RLS で弾かれる latent バグの修正）

-- ---------------------------------------------------------------
-- 1. members.avatar_url
-- ---------------------------------------------------------------
alter table public.members
  add column if not exists avatar_url text;

-- ---------------------------------------------------------------
-- 2. organizations の INSERT RLS 緩和
-- ---------------------------------------------------------------
drop policy if exists orgs_insert_verified on public.organizations;

create policy orgs_insert_email_only on public.organizations
  for insert with check (
    exists (
      select 1 from public.members
       where id = auth.uid()
         and tier in ('email_only', 'verified')
         and deleted_at is null
    )
    and representative_id = auth.uid()
    -- 新規登録は必ず非公開で作成（管理者承認後に public_flag=true に更新される）
    and public_flag = false
  );

-- 管理者は public_flag を切り替えられる（既存の orgs_update_admin がカバーするが念のため明示）
-- orgs_update_admin は public.is_committee_or_super() を使用、これは既存のまま流用。

-- ---------------------------------------------------------------
-- 3. memberships RLS: representative の self-confirmed INSERT を許可
-- ---------------------------------------------------------------
-- 既存の memberships_insert_self は status='claimed' のみ許可していたため、
-- createOrganization が同一トランザクション内で representative メンバーシップを
-- status='confirmed' で挿入しようとすると RLS で弾かれていた。
-- 修正: 自分が representative_id である org に限り status='confirmed' での自己挿入を許可。

create policy memberships_insert_rep_self on public.memberships
  for insert with check (
    member_id = auth.uid()
    and role = 'representative'
    and status = 'confirmed'
    and exists (
      select 1 from public.organizations
       where id = memberships.org_id
         and representative_id = auth.uid()
    )
  );
