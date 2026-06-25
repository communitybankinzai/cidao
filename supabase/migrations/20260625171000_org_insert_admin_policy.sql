-- 補足: 管理者は public_flag=true で直接 INSERT 可能にする
-- 20260625170000 の orgs_insert_email_only は一般ユーザー向けに public_flag=false 強制だが、
-- admin（admin_role IS NOT NULL）は即公開で登録できるべきなので、別ポリシーを追加。

create policy orgs_insert_admin on public.organizations
  for insert with check (
    exists (
      select 1 from public.members
       where id = auth.uid()
         and admin_role is not null
         and deleted_at is null
    )
    and representative_id = auth.uid()
  );
