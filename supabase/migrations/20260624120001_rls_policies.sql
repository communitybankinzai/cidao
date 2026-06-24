-- =============================================================
-- CiDAO RLS ポリシー
-- 設計方針:
--   - デフォルト deny。各操作（SELECT/INSERT/UPDATE/DELETE）を明示
--   - 個人投票秘密：votes は本人にも非表示（service_role のみ集計）
--   - admin_role（committee/super）は SECURITY DEFINER で権限分離
--   - contributions / audit_logs は trigger 経由のみ書込（直接 INSERT 禁止）
-- =============================================================

-- ===========================
-- ヘルパー関数（admin チェック）
-- ===========================
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    (select admin_role is not null from public.members where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_committee_or_super()
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    (select admin_role in ('committee', 'super') from public.members where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_org_representative(org uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists(
    select 1 from public.organizations
     where id = org and representative_id = auth.uid()
  );
$$;

create or replace function public.is_org_officer(org uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists(
    select 1 from public.memberships
     where org_id = org
       and member_id = auth.uid()
       and role in ('representative', 'officer')
       and status = 'confirmed'
       and left_at is null
  );
$$;

-- ===========================
-- members
-- ===========================
create policy members_select_own on public.members
  for select using (id = auth.uid());

create policy members_select_others on public.members
  for select using (
    deleted_at is null
    and id <> auth.uid()
  );  -- 公開項目は public_settings で制御するが、レコード自体は閲覧可

create policy members_select_admin on public.members
  for select using (public.is_admin());

create policy members_update_own on public.members
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy members_insert_self on public.members
  for insert with check (id = auth.uid());

-- DELETE は禁止（soft delete のみ、deleted_at 更新で）

-- ===========================
-- organizations
-- ===========================
create policy orgs_select_public on public.organizations
  for select using (public_flag = true);

create policy orgs_select_member on public.organizations
  for select using (
    exists (
      select 1 from public.memberships
       where org_id = organizations.id
         and member_id = auth.uid()
         and left_at is null
    )
  );

create policy orgs_insert_verified on public.organizations
  for insert with check (
    exists (select 1 from public.members where id = auth.uid() and tier = 'verified')
    and representative_id = auth.uid()
  );

create policy orgs_update_rep on public.organizations
  for update using (representative_id = auth.uid())
            with check (representative_id = auth.uid());

create policy orgs_update_admin on public.organizations
  for update using (public.is_committee_or_super());

create policy orgs_delete_admin on public.organizations
  for delete using (public.is_committee_or_super());

-- ===========================
-- organization_categories
-- ===========================
create policy org_cat_select_all on public.organization_categories
  for select using (true);

create policy org_cat_write_rep on public.organization_categories
  for all using (public.is_org_representative(org_id))
         with check (public.is_org_representative(org_id));

-- ===========================
-- memberships
-- ===========================
create policy memberships_select_self on public.memberships
  for select using (member_id = auth.uid());

create policy memberships_select_display on public.memberships
  for select using (display_in_org = true and status = 'confirmed' and left_at is null);

create policy memberships_select_org_rep on public.memberships
  for select using (public.is_org_representative(org_id));

create policy memberships_select_admin on public.memberships
  for select using (public.is_admin());

create policy memberships_insert_self on public.memberships
  for insert with check (
    member_id = auth.uid()
    and status = 'claimed'
  );

create policy memberships_update_self on public.memberships
  for update using (member_id = auth.uid())
            with check (member_id = auth.uid());

create policy memberships_update_rep on public.memberships
  for update using (public.is_org_representative(org_id));

create policy memberships_delete_self on public.memberships
  for delete using (member_id = auth.uid());

create policy memberships_delete_rep on public.memberships
  for delete using (public.is_org_representative(org_id));

-- ===========================
-- proposals
-- ===========================
create policy proposals_select_public on public.proposals
  for select using (status <> 'draft');

create policy proposals_select_own on public.proposals
  for select using (proposer_id = auth.uid());

create policy proposals_select_admin on public.proposals
  for select using (public.is_admin());

create policy proposals_insert_member on public.proposals
  for insert with check (
    proposer_id = auth.uid()
    and exists (select 1 from public.members where id = auth.uid() and tier in ('email_only','verified'))
  );

create policy proposals_update_proposer on public.proposals
  for update using (
    proposer_id = auth.uid()
    and status in ('draft', 'discussion')
  ) with check (proposer_id = auth.uid());

create policy proposals_update_admin on public.proposals
  for update using (public.is_committee_or_super());

create policy proposals_delete_admin on public.proposals
  for delete using (public.is_committee_or_super());

-- ===========================
-- votes（個人投票秘密：本人にも非表示）
-- ===========================
-- SELECT ポリシーは存在しない → クライアントから読めない
-- 集計は vote_aggregates 経由
create policy votes_select_admin on public.votes
  for select using (public.is_committee_or_super());

create policy votes_insert_member on public.votes
  for insert with check (
    voter_id = auth.uid()
    and exists (
      select 1 from public.proposals
       where id = proposal_id
         and status = 'voting'
         and voting_start_at <= now() and voting_end_at > now()
    )
  );

create policy votes_update_own on public.votes
  for update using (voter_id = auth.uid())
            with check (voter_id = auth.uid());

-- DELETE 禁止（撤回は retracted_at で表現）

-- ===========================
-- vote_aggregates（読みは公開）
-- ===========================
create policy vote_aggregates_select_all on public.vote_aggregates
  for select using (true);

-- 書込は service_role のみ（policy なし）

-- ===========================
-- comments
-- ===========================
create policy comments_select_all on public.comments
  for select using (
    exists (select 1 from public.proposals where id = proposal_id and status <> 'draft')
  );

create policy comments_insert_member on public.comments
  for insert with check (
    author_id = auth.uid()
    and exists (select 1 from public.members where id = auth.uid() and tier in ('email_only','verified'))
  );

create policy comments_update_own on public.comments
  for update using (author_id = auth.uid())
            with check (author_id = auth.uid());

create policy comments_delete_own on public.comments
  for delete using (author_id = auth.uid());

create policy comments_delete_admin on public.comments
  for delete using (public.is_committee_or_super());

-- ===========================
-- faqs
-- ===========================
create policy faqs_select_all on public.faqs
  for select using (true);

create policy faqs_write_admin on public.faqs
  for all using (public.is_committee_or_super())
         with check (public.is_committee_or_super());

-- ===========================
-- events
-- ===========================
create policy events_select_public on public.events
  for select using (status <> 'draft');

create policy events_select_organizer on public.events
  for select using (
    (organizer_type = 'member' and organizer_id = auth.uid())
    or (organizer_type = 'org' and public.is_org_officer(organizer_id))
  );

create policy events_insert_member on public.events
  for insert with check (
    exists (select 1 from public.members where id = auth.uid() and tier in ('email_only','verified'))
    and (
      (organizer_type = 'member' and organizer_id = auth.uid())
      or (organizer_type = 'org' and public.is_org_officer(organizer_id))
    )
  );

create policy events_update_organizer on public.events
  for update using (
    (organizer_type = 'member' and organizer_id = auth.uid())
    or (organizer_type = 'org' and public.is_org_officer(organizer_id))
  );

create policy events_delete_organizer on public.events
  for delete using (
    (organizer_type = 'member' and organizer_id = auth.uid())
    or (organizer_type = 'org' and public.is_org_officer(organizer_id))
    or public.is_committee_or_super()
  );

-- ===========================
-- event_participants
-- ===========================
create policy ep_select_self on public.event_participants
  for select using (member_id = auth.uid());

create policy ep_select_organizer on public.event_participants
  for select using (
    exists (
      select 1 from public.events e
       where e.id = event_id
         and ((e.organizer_type = 'member' and e.organizer_id = auth.uid())
              or (e.organizer_type = 'org' and public.is_org_officer(e.organizer_id)))
    )
  );

create policy ep_insert_self on public.event_participants
  for insert with check (member_id = auth.uid());

create policy ep_delete_self on public.event_participants
  for delete using (member_id = auth.uid());

-- ===========================
-- freefree_posts
-- ===========================
create policy freefree_select_active on public.freefree_posts
  for select using (status = 'active');

create policy freefree_select_own on public.freefree_posts
  for select using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_officer(poster_id))
  );

create policy freefree_select_admin on public.freefree_posts
  for select using (public.is_committee_or_super());

create policy freefree_insert_member on public.freefree_posts
  for insert with check (
    exists (select 1 from public.members where id = auth.uid() and tier in ('email_only','verified'))
    and (
      (poster_type = 'member' and poster_id = auth.uid())
      or (poster_type = 'org' and public.is_org_officer(poster_id))
      or poster_type = 'individual_business'
    )
  );

create policy freefree_update_poster on public.freefree_posts
  for update using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_officer(poster_id))
  );

create policy freefree_delete_poster on public.freefree_posts
  for delete using (
    (poster_type = 'member' and poster_id = auth.uid())
    or (poster_type = 'org' and public.is_org_officer(poster_id))
    or public.is_committee_or_super()
  );

-- ===========================
-- coupons / coupon_uses / supports
-- ===========================
create policy coupons_select_public on public.coupons
  for select using (
    exists (select 1 from public.freefree_posts where id = post_id and status = 'active')
  );

create policy coupons_write_poster on public.coupons
  for all using (
    exists (
      select 1 from public.freefree_posts p
       where p.id = post_id
         and ((p.poster_type = 'member' and p.poster_id = auth.uid())
              or (p.poster_type = 'org' and public.is_org_officer(p.poster_id)))
    )
  );

create policy coupon_uses_select_self on public.coupon_uses
  for select using (member_id = auth.uid());

create policy coupon_uses_insert_self on public.coupon_uses
  for insert with check (member_id = auth.uid());

create policy supports_select_all on public.supports
  for select using (
    exists (select 1 from public.freefree_posts where id = post_id and status = 'active')
  );

create policy supports_insert_member on public.supports
  for insert with check (
    member_id = auth.uid()
    and exists (select 1 from public.members where id = auth.uid() and tier in ('email_only','verified'))
  );

create policy supports_delete_self on public.supports
  for delete using (member_id = auth.uid());

-- ===========================
-- messages
-- ===========================
create policy messages_select_party on public.messages
  for select using (sender_id = auth.uid() or recipient_id = auth.uid());

create policy messages_insert_sender on public.messages
  for insert with check (
    sender_id = auth.uid()
    and not exists (
      select 1 from public.blocks
       where blocker_id = recipient_id and blocked_id = auth.uid()
    )
  );

create policy messages_update_recipient on public.messages
  for update using (recipient_id = auth.uid())
            with check (recipient_id = auth.uid());

-- ===========================
-- blocks
-- ===========================
create policy blocks_select_own on public.blocks
  for select using (blocker_id = auth.uid());

create policy blocks_write_own on public.blocks
  for all using (blocker_id = auth.uid())
         with check (blocker_id = auth.uid());

-- ===========================
-- member_profiles_pr
-- ===========================
create policy pr_select_public on public.member_profiles_pr
  for select using (public_scope = 'public');

create policy pr_select_registered on public.member_profiles_pr
  for select using (
    public_scope in ('public', 'registered_only')
    and auth.uid() is not null
  );

create policy pr_select_own on public.member_profiles_pr
  for select using (member_id = auth.uid());

create policy pr_write_own on public.member_profiles_pr
  for all using (member_id = auth.uid())
         with check (member_id = auth.uid());

-- ===========================
-- contributions（読みは本人 + admin、書込は trigger のみ）
-- ===========================
create policy contributions_select_self on public.contributions
  for select using (actor_id = auth.uid());

create policy contributions_select_admin on public.contributions
  for select using (public.is_admin());

-- INSERT は trigger（SECURITY DEFINER）経由のみ。直接ポリシーなし。

-- ===========================
-- sns_post_logs / sns_rotation
-- ===========================
create policy sns_logs_select_admin on public.sns_post_logs
  for select using (public.is_admin());

create policy sns_rotation_select_admin on public.sns_rotation
  for select using (public.is_admin());

-- 書込は service_role のみ。

-- ===========================
-- audit_logs（読みは本人 + admin、書込は trigger のみ）
-- ===========================
create policy audit_select_self on public.audit_logs
  for select using (actor_id = auth.uid());

create policy audit_select_admin on public.audit_logs
  for select using (public.is_admin());
