-- =============================================================
-- FreeFree の団体投稿権限を「代表者・役員のみ」→「所属メンバーなら誰でも」に緩和
-- （代表新井氏の要望 2026-07-25）
--
-- - is_org_member(): 所属確定済み（status=confirmed, 未退会）なら役職不問で true。
--   組織の representative_id 直指定（claim前の団体代表）も true
-- - freefree_posts の select_own / insert / update / delete と coupons の
--   write ポリシーを is_org_officer → is_org_member に差し替え
-- =============================================================

create or replace function public.is_org_member(org uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select public.is_org_representative(org) or exists(
    select 1 from public.memberships
     where org_id = org
       and member_id = auth.uid()
       and status = 'confirmed'
       and left_at is null
  );
$$;

drop policy if exists freefree_select_own on public.freefree_posts;
create policy freefree_select_own on public.freefree_posts
  for select using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_member(poster_id))
  );

drop policy if exists freefree_insert_member on public.freefree_posts;
create policy freefree_insert_member on public.freefree_posts
  for insert with check (
    exists (select 1 from public.members where id = auth.uid() and tier in ('email_only','verified'))
    and (
      (poster_type = 'member' and poster_id = auth.uid())
      or (poster_type = 'org' and public.is_org_member(poster_id))
      or poster_type = 'individual_business'
    )
  );

drop policy if exists freefree_update_poster on public.freefree_posts;
create policy freefree_update_poster on public.freefree_posts
  for update using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_member(poster_id))
  );

drop policy if exists freefree_delete_poster on public.freefree_posts;
create policy freefree_delete_poster on public.freefree_posts
  for delete using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_member(poster_id))
    or public.is_committee_or_super()
  );

drop policy if exists coupons_write_poster on public.coupons;
create policy coupons_write_poster on public.coupons
  for all using (
    exists (
      select 1 from public.freefree_posts p
       where p.id = post_id
         and ((p.poster_type = 'member' and p.poster_id = auth.uid())
              or (p.poster_type = 'org' and public.is_org_member(p.poster_id)))
    )
  );
