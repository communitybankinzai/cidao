-- 「団体を作る人 = 代表者」という従来の暗黙仮定を緩める。
-- 作成者は自分が代表者かどうかをフォームで選べるべきなので、
-- representative_id を nullable 化し、INSERT RLS でも NULL を許可する。

-- ---------------------------------------------------------------
-- 1. organizations.representative_id を nullable 化
-- ---------------------------------------------------------------
alter table public.organizations
  alter column representative_id drop not null;

-- ---------------------------------------------------------------
-- 2. INSERT RLS 緩和: representative_id IS NULL も許可
-- ---------------------------------------------------------------
drop policy if exists orgs_insert_email_only on public.organizations;
create policy orgs_insert_email_only on public.organizations
  for insert with check (
    exists (
      select 1 from public.members
       where id = auth.uid()
         and tier in ('email_only', 'verified')
         and deleted_at is null
    )
    and (representative_id = auth.uid() or representative_id is null)
    -- 新規登録は必ず非公開で作成（管理者承認後に public_flag=true に更新される）
    and public_flag = false
  );

drop policy if exists orgs_insert_admin on public.organizations;
create policy orgs_insert_admin on public.organizations
  for insert with check (
    exists (
      select 1 from public.members
       where id = auth.uid()
         and admin_role is not null
         and deleted_at is null
    )
    and (representative_id = auth.uid() or representative_id is null)
  );

-- ---------------------------------------------------------------
-- 3. memberships の self-confirmed INSERT も as_representative=false で
--    role='member' / status='confirmed' を許可（admin 作成時）
-- ---------------------------------------------------------------
-- 既存 memberships_insert_rep_self は role='representative' のみ許可していたが、
-- 「代表者ではない」で団体を作った admin が自分を会員として記録するパスもありうる。
-- ただし一般ユーザーは status='claimed' のみ自己 INSERT 可能（既存ポリシー維持）。

create policy memberships_insert_self_member_confirmed on public.memberships
  for insert with check (
    member_id = auth.uid()
    and role = 'member'
    and status = 'confirmed'
    and exists (
      select 1 from public.members
       where id = auth.uid()
         and admin_role is not null
    )
  );
